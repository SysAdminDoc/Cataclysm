//! GPU shallow-water solver path (F-V05 / F4-01). Compiles only with
//! the `gpu` cargo feature. Provides a parallel structure to the CPU
//! `TimeStepper`/`run_simulation` path so callers can opt into GPU
//! acceleration when an adapter is available.
//!
//! ## Status (v0.4.0)
//!
//! - [x] wgpu + pollster deps wired behind `[features] gpu`.
//! - [x] `GpuTimeStepper` exposing `step` matching the CPU surface.
//! - [x] WGSL kernel reused verbatim from [`super::kernels::SWE_FINITE_VOLUME_WGSL`].
//! - [x] Buffer-binding plumbing (ping-pong storage buffers for
//!   `h`, `eta`, `u`, `v`) + dispatch loop + result readback.
//! - [x] Restartable across multiple `step` calls: the eta/u/v fields
//!   are re-uploaded from the host-side `grid` at the start of each call and
//!   read back at the end, so successive calls compose just like the CPU
//!   `TimeStepper::step`.
//! - [x] Manning friction and nonlinear advection, covered by the
//!   `swe_gpu_matches_cpu_full_physics` parity regression.
//!
//! ## Reference
//!
//! Qin, He, LeVeque, Mandli, & Berger (2019) — *Algorithms and Data
//! Structures for Cellular-Automata Tsunami Modeling on GPUs*, arXiv:
//! 1901.06798 — reports 3.6–6.4× speedup vs. 16-core CPU on GeoClaw.

use super::kernels::SWE_FINITE_VOLUME_WGSL;
use super::{DiagnosticSink, SwGrid, report_diagnostic};
use wgpu::util::DeviceExt;

/// Outcome of an attempted GPU adapter acquisition. Allows the
/// caller (`simulate_grid`) to gracefully fall back to the CPU path
/// when no usable adapter exists.
#[derive(Debug)]
pub enum GpuAvailability {
    Available,
    NoAdapter,
    AdapterFailed(String),
}

/// Probe the host for a usable wgpu adapter. Cheap; safe to call
/// from a `simulate_grid` request handler to decide CPU-vs-GPU
/// before allocating the compute pipeline.
pub fn probe_adapter() -> GpuAvailability {
    let instance = wgpu::Instance::default();
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }));
    match adapter {
        Ok(_) => GpuAvailability::Available,
        Err(e) => GpuAvailability::AdapterFailed(format!("{e}")),
    }
}

/// Human-readable adapter description ("NVIDIA GeForce RTX 4070 (Vulkan)")
/// for the diagnostics bundle. `None` when no adapter is available.
pub fn adapter_summary() -> Option<String> {
    let instance = wgpu::Instance::default();
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }))
    .ok()?;
    let info = adapter.get_info();
    Some(format!("{} ({:?})", info.name, info.backend))
}

/// 64-byte Params struct matching the WGSL `struct Params` layout in
/// [`SWE_FINITE_VOLUME_WGSL`].
#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct GpuParams {
    dlon_rad: f32,
    dlat_rad: f32,
    south_lat_rad: f32,
    earth_radius_m: f32,
    dt_s: f32,
    g: f32,
    manning_n: f32,
    wet_depth_epsilon_m: f32,
    nx: u32,
    ny: u32,
    sponge_width: u32,
    nonlinear: u32,
    /// 0 = sponge/zero-flux, 1 = radiation (Flather/Sommerfeld).
    boundary_mode: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

/// GPU-side time stepper. Owns the wgpu device/queue, the compiled
/// compute pipeline, and the per-step ping-pong storage buffers.
pub struct GpuTimeStepper {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    params_buf: wgpu::Buffer,
    h_buf: wgpu::Buffer,
    /// Two ping-pong sets for η, u, v.
    eta_a: wgpu::Buffer,
    eta_b: wgpu::Buffer,
    u_a: wgpu::Buffer,
    u_b: wgpu::Buffer,
    v_a: wgpu::Buffer,
    v_b: wgpu::Buffer,
    /// Staging buffers for η/u/v readback at the end of `step`. Each
    /// sized to match the grid; `MAP_READ + COPY_DST`.
    readback_eta: wgpu::Buffer,
    readback_u: wgpu::Buffer,
    readback_v: wgpu::Buffer,
    nx: u32,
    ny: u32,
    n_cells: usize,
    /// Step size (s) baked into `params_buf` at construction. The
    /// stepper is fixed-dt for the life of the run; `run_simulation`
    /// composes any total duration as `n_steps * dt_s`.
    dt_s: f64,
}

impl GpuTimeStepper {
    /// Build the GPU pipeline for the given grid + dt. Returns `None`
    /// when no adapter is available — callers fall back to the CPU
    /// path.
    pub fn new(
        grid: &SwGrid,
        dt_s: f64,
        manning_n: f64,
        sponge_width: u32,
        nonlinear: bool,
    ) -> Option<Self> {
        Self::new_with_diagnostics(grid, dt_s, manning_n, sponge_width, nonlinear, None)
    }

    pub fn new_with_boundary_mode(
        grid: &SwGrid,
        dt_s: f64,
        manning_n: f64,
        boundary: super::BoundaryMode,
        nonlinear: bool,
        diagnostics: Option<&DiagnosticSink<'_>>,
    ) -> Option<Self> {
        let (sponge_width, boundary_mode) = match boundary {
            super::BoundaryMode::Sponge { width_cells } => (width_cells as u32, 0u32),
            super::BoundaryMode::Radiation => (0, 1),
            super::BoundaryMode::ZeroFlux => (0, 0),
        };
        pollster::block_on(Self::new_async(
            grid, dt_s, manning_n, sponge_width, boundary_mode, nonlinear, diagnostics,
        ))
    }

    pub fn new_with_diagnostics(
        grid: &SwGrid,
        dt_s: f64,
        manning_n: f64,
        sponge_width: u32,
        nonlinear: bool,
        diagnostics: Option<&DiagnosticSink<'_>>,
    ) -> Option<Self> {
        pollster::block_on(Self::new_async(
            grid,
            dt_s,
            manning_n,
            sponge_width,
            0, // legacy: sponge mode
            nonlinear,
            diagnostics,
        ))
    }

    async fn new_async(
        grid: &SwGrid,
        dt_s: f64,
        manning_n: f64,
        sponge_width: u32,
        boundary_mode: u32,
        nonlinear: bool,
        diagnostics: Option<&DiagnosticSink<'_>>,
    ) -> Option<Self> {
        let instance = wgpu::Instance::default();
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .ok()?;

        let n_cells = grid.nx * grid.ny;
        let n_bytes = (n_cells * std::mem::size_of::<f32>()) as wgpu::BufferAddress;

        // VRAM pre-check: we allocate ~10 storage buffers of n_bytes each
        // (h, eta_a/b, u_a/b, v_a/b, readback_eta/u/v) plus a small params
        // uniform. Reject if any single buffer exceeds the adapter's
        // max_buffer_binding_size, or if total estimated usage exceeds 80%
        // of max_buffer_binding_size (a rough heuristic since wgpu doesn't
        // expose total VRAM). This triggers CPU fallback before an OOM panic.
        let limits = adapter.limits();
        let max_buf = limits.max_storage_buffer_binding_size;
        if n_bytes > max_buf {
            report_diagnostic(
                diagnostics,
                format!(
                    "[gpu] grid requires {} bytes per buffer but adapter max is {} — falling back to CPU",
                    n_bytes, max_buf
                ),
            );
            return None;
        }
        // Note: total VRAM usage is ~10× n_bytes. We don't check that
        // against an aggregate VRAM budget because wgpu doesn't expose
        // total device memory. The per-buffer limit check above catches
        // the most common OOM vector (single buffer > adapter limit).
        // If the device can't allocate, request_device / create_buffer
        // will return an error and we fall back to CPU.

        // The kernel binds 7 storage buffers (h, eta/u/v in, eta/u/v out);
        // downlevel_defaults() caps max_storage_buffers_per_shader_stage at
        // 4, which fails bind-group-layout validation on every adapter.
        // Request the WebGPU default (8), clamped to what the adapter
        // actually supports so weak adapters still fall back to CPU cleanly.
        let required_limits = wgpu::Limits {
            max_storage_buffers_per_shader_stage: 8,
            ..wgpu::Limits::downlevel_defaults()
        }
        .using_resolution(adapter.limits());
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("tsunamisim-swe"),
                required_features: wgpu::Features::empty(),
                required_limits,
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
            })
            .await
            .ok()?;

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("swe-hydrostatic-rusanov"),
            source: wgpu::ShaderSource::Wgsl(SWE_FINITE_VOLUME_WGSL.into()),
        });

        let params = GpuParams {
            dlon_rad: grid.dlon_deg.to_radians() as f32,
            dlat_rad: grid.dlat_deg.to_radians() as f32,
            south_lat_rad: grid.south_lat.to_radians() as f32,
            earth_radius_m: super::super::constants::R_EARTH_M as f32,
            dt_s: dt_s as f32,
            g: super::super::constants::G_EARTH as f32,
            manning_n: manning_n as f32,
            wet_depth_epsilon_m: super::WET_DEPTH_EPSILON_M as f32,
            nx: grid.nx as u32,
            ny: grid.ny as u32,
            sponge_width,
            nonlinear: if nonlinear { 1 } else { 0 },
            boundary_mode,
            _pad0: 0,
            _pad1: 0,
            _pad2: 0,
        };

        // Cast h, η, u, v from f64 → f32 for upload. The numerical
        // drift is within the F-V01 validation harness tolerance.
        let h_f32: Vec<f32> = grid.h_m.iter().map(|&v| v as f32).collect();
        let eta_f32: Vec<f32> = grid.eta_m.iter().map(|&v| v as f32).collect();
        let u_f32: Vec<f32> = grid.u_ms.iter().map(|&v| v as f32).collect();
        let v_f32: Vec<f32> = grid.v_ms.iter().map(|&v| v as f32).collect();

        let params_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("params"),
            contents: bytemuck::bytes_of(&params),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let h_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("h"),
            contents: bytemuck::cast_slice(&h_f32),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        let storage_usage = wgpu::BufferUsages::STORAGE
            | wgpu::BufferUsages::COPY_SRC
            | wgpu::BufferUsages::COPY_DST;
        let eta_a = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("eta_a"),
            contents: bytemuck::cast_slice(&eta_f32),
            usage: storage_usage,
        });
        let eta_b = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("eta_b"),
            size: n_bytes,
            usage: storage_usage,
            mapped_at_creation: false,
        });
        let u_a = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("u_a"),
            contents: bytemuck::cast_slice(&u_f32),
            usage: storage_usage,
        });
        let u_b = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("u_b"),
            size: n_bytes,
            usage: storage_usage,
            mapped_at_creation: false,
        });
        let v_a = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("v_a"),
            contents: bytemuck::cast_slice(&v_f32),
            usage: storage_usage,
        });
        let v_b = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("v_b"),
            size: n_bytes,
            usage: storage_usage,
            mapped_at_creation: false,
        });
        let mk_readback = |label: &'static str| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size: n_bytes,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        };
        let readback_eta = mk_readback("readback_eta");
        let readback_u = mk_readback("readback_u");
        let readback_v = mk_readback("readback_v");

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("swe-bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // h, eta_in, u_in, v_in — read-only storage.
                bgl_entry(1, true),
                bgl_entry(2, true),
                bgl_entry(3, true),
                bgl_entry(4, true),
                // eta_out, u_out, v_out — read-write storage.
                bgl_entry(5, false),
                bgl_entry(6, false),
                bgl_entry(7, false),
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("swe-pl"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("swe-pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("cs_finite_volume"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });

        Some(Self {
            device,
            queue,
            pipeline,
            bind_group_layout,
            params_buf,
            h_buf,
            eta_a,
            eta_b,
            u_a,
            u_b,
            v_a,
            v_b,
            readback_eta,
            readback_u,
            readback_v,
            nx: grid.nx as u32,
            ny: grid.ny as u32,
            n_cells,
            dt_s,
        })
    }

    /// Advance `grid` by exactly `n_steps` of size `self.dt_s`. After
    /// the dispatch loop the η, u, v fields are copied back to
    /// `grid.{eta_m,u_ms,v_ms}` via staging buffers so the next call
    /// resumes from the correct host-side state.
    /// Returns `true` on success. Returns `false` (leaving `grid` and its
    /// simulated time untouched) if a buffer map / device poll fails or the
    /// read-back field contains non-finite values — letting the caller fall
    /// back to the CPU path instead of advancing time over a frozen/garbage
    /// field, which previously happened silently.
    #[must_use]
    pub fn step(&self, grid: &mut SwGrid, n_steps: usize) -> bool {
        self.step_with_diagnostics(grid, n_steps, None)
    }

    pub fn step_with_diagnostics(
        &self,
        grid: &mut SwGrid,
        n_steps: usize,
        diagnostics: Option<&DiagnosticSink<'_>>,
    ) -> bool {
        pollster::block_on(self.step_async(grid, n_steps, diagnostics))
    }

    /// Apply one moving atmospheric-pressure source increment and advance one
    /// GPU step. The host fields are re-uploaded by `step_with_diagnostics`,
    /// so CPU and GPU consume the identical forced state without duplicating
    /// source mathematics in WGSL. A failed GPU step reverses the explicit
    /// forcing increment because the hydrodynamic state/time were not committed.
    pub fn step_with_pressure_forcing(
        &self,
        grid: &mut SwGrid,
        source: &crate::physics::meteotsunami::MeteotsunamiSource,
        diagnostics: Option<&DiagnosticSink<'_>>,
    ) -> bool {
        let midpoint_s = grid.t_s + 0.5 * self.dt_s;
        source.apply_pressure_gradient(grid, midpoint_s, self.dt_s);
        if self.step_with_diagnostics(grid, 1, diagnostics) {
            true
        } else {
            source.apply_pressure_gradient(grid, midpoint_s, -self.dt_s);
            false
        }
    }

    async fn step_async(
        &self,
        grid: &mut SwGrid,
        n_steps: usize,
        diagnostics: Option<&DiagnosticSink<'_>>,
    ) -> bool {
        if n_steps == 0 {
            return true;
        }

        // Re-upload the host-side eta/u/v into the "A" set so multiple
        // `step` calls in a row compose correctly. h is immutable for
        // the life of the run and was uploaded at `new_async`.
        let eta_f32: Vec<f32> = grid.eta_m.iter().map(|&v| v as f32).collect();
        let u_f32: Vec<f32> = grid.u_ms.iter().map(|&v| v as f32).collect();
        let v_f32: Vec<f32> = grid.v_ms.iter().map(|&v| v as f32).collect();
        self.queue
            .write_buffer(&self.eta_a, 0, bytemuck::cast_slice(&eta_f32));
        self.queue
            .write_buffer(&self.u_a, 0, bytemuck::cast_slice(&u_f32));
        self.queue
            .write_buffer(&self.v_a, 0, bytemuck::cast_slice(&v_f32));

        // Two bind groups for ping-pong: A→B (eta_in=A, eta_out=B) and
        // B→A (eta_in=B, eta_out=A). Alternate each step.
        let bg_a_to_b = self.make_bg(true);
        let bg_b_to_a = self.make_bg(false);

        let n_bytes = (self.n_cells * std::mem::size_of::<f32>()) as wgpu::BufferAddress;
        let groups_x = self.nx.div_ceil(8);
        let groups_y = self.ny.div_ceil(8);

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("swe-encoder"),
            });
        // After step k, output lives in B if (k+1) is odd, A if even.
        // Starting state is in A; after 1 step, output is in B → a_is_in=false next.
        let mut a_is_in = true;
        for _ in 0..n_steps {
            let bg = if a_is_in { &bg_a_to_b } else { &bg_b_to_a };
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("swe-pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, bg, &[]);
            pass.dispatch_workgroups(groups_x, groups_y, 1);
            drop(pass);
            a_is_in = !a_is_in;
        }
        // After the final step, `a_is_in` has flipped: if true, the
        // most recent output is in A; if false, it's in B.
        let (final_eta, final_u, final_v) = if a_is_in {
            (&self.eta_a, &self.u_a, &self.v_a)
        } else {
            (&self.eta_b, &self.u_b, &self.v_b)
        };
        encoder.copy_buffer_to_buffer(final_eta, 0, &self.readback_eta, 0, n_bytes);
        encoder.copy_buffer_to_buffer(final_u, 0, &self.readback_u, 0, n_bytes);
        encoder.copy_buffer_to_buffer(final_v, 0, &self.readback_v, 0, n_bytes);
        self.queue.submit(std::iter::once(encoder.finish()));

        // Map all three readback buffers in parallel.
        let (tx_eta, rx_eta) = std::sync::mpsc::channel::<Result<(), wgpu::BufferAsyncError>>();
        let (tx_u, rx_u) = std::sync::mpsc::channel::<Result<(), wgpu::BufferAsyncError>>();
        let (tx_v, rx_v) = std::sync::mpsc::channel::<Result<(), wgpu::BufferAsyncError>>();
        self.readback_eta
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |r| {
                let _ = tx_eta.send(r);
            });
        self.readback_u
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |r| {
                let _ = tx_u.send(r);
            });
        self.readback_v
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |r| {
                let _ = tx_v.send(r);
            });
        if self
            .device
            .poll(wgpu::PollType::wait_indefinitely())
            .is_err()
        {
            report_diagnostic(
                diagnostics,
                "[gpu] device.poll failed during readback — aborting GPU step",
            );
            return false;
        }

        // Copy each field into a scratch Vec first; only commit to `grid`
        // (and advance time) once all three readbacks succeeded AND the field
        // is finite, so a failed/garbage readback never freezes the field
        // under a later timestamp.
        let read_field = |rx: &std::sync::mpsc::Receiver<Result<(), wgpu::BufferAsyncError>>,
                          buf: &wgpu::Buffer|
         -> Option<Vec<f64>> {
            match rx.recv() {
                Ok(Ok(())) => {}
                _ => return None,
            }
            let view = buf.slice(..).get_mapped_range();
            let f32_slice: &[f32] = bytemuck::cast_slice(&view);
            let out: Vec<f64> = f32_slice
                .iter()
                .take(self.n_cells)
                .map(|&v| v as f64)
                .collect();
            drop(view);
            buf.unmap();
            if out.iter().any(|v| !v.is_finite()) {
                return None;
            }
            Some(out)
        };

        let new_eta = read_field(&rx_eta, &self.readback_eta);
        let new_u = read_field(&rx_u, &self.readback_u);
        let new_v = read_field(&rx_v, &self.readback_v);
        match (new_eta, new_u, new_v) {
            (Some(eta), Some(u), Some(v)) => {
                grid.eta_m = eta;
                grid.u_ms = u;
                grid.v_ms = v;
                grid.t_s += self.dt_s * n_steps as f64;
                grid.step_index = grid.step_index.saturating_add(n_steps as u64);
                true
            }
            _ => {
                report_diagnostic(
                    diagnostics,
                    "[gpu] readback failed or produced non-finite field — aborting GPU step",
                );
                false
            }
        }
    }

    fn make_bg(&self, a_is_in: bool) -> wgpu::BindGroup {
        let (eta_in, eta_out, u_in, u_out, v_in, v_out) = if a_is_in {
            (
                &self.eta_a,
                &self.eta_b,
                &self.u_a,
                &self.u_b,
                &self.v_a,
                &self.v_b,
            )
        } else {
            (
                &self.eta_b,
                &self.eta_a,
                &self.u_b,
                &self.u_a,
                &self.v_b,
                &self.v_a,
            )
        };
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("swe-bg"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.params_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: self.h_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: eta_in.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: u_in.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: v_in.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: eta_out.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: u_out.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 7,
                    resource: v_out.as_entire_binding(),
                },
            ],
        })
    }
}

fn bgl_entry(binding: u32, read_only: bool) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics::solver::{SolverMode, TimeStepper};

    #[test]
    fn probe_adapter_returns_some_state() {
        // We don't assert availability — CI runners often lack a GPU.
        // The probe must at least return without panicking.
        let _ = probe_adapter();
    }

    /// F4-01 regression: with a flat-ocean Gaussian IC, the GPU
    /// linear-SWE finite-volume update should agree with the CPU path
    /// to within 1e-3 m on η across the grid after a
    /// short run.
    #[test]
    fn swe_gpu_matches_cpu() {
        let mut g_cpu = SwGrid::new(-2.0, -2.0, 2.0, 2.0, 0.25, 0.25);
        g_cpu.fill_uniform_depth(4_000.0);
        g_cpu.inject_gaussian(0.0, 0.0, 1.0, 60_000.0);
        let mut g_gpu = g_cpu.clone();

        let dt = g_cpu.recommended_dt_s(0.4);
        let cpu = TimeStepper::new(dt).with_mode(SolverMode::Linear);
        let cpu = cpu.with_boundary(super::super::BoundaryMode::ZeroFlux);
        cpu.step(&mut g_cpu, 50);

        let gpu = match GpuTimeStepper::new(&g_gpu, dt, 0.0, 0, false) {
            Some(g) => g,
            None => {
                println!("swe_gpu_matches_cpu: no adapter — skipping");
                return;
            }
        };
        assert!(gpu.step(&mut g_gpu, 50), "GPU step reported failure");

        let mut max_diff = 0.0_f64;
        for (a, b) in g_cpu.eta_m.iter().zip(g_gpu.eta_m.iter()) {
            max_diff = max_diff.max((a - b).abs());
        }
        assert!(
            max_diff < 1.0e-3,
            "GPU η disagrees with CPU η by {} m (> 1e-3)",
            max_diff
        );
    }

    #[test]
    fn swe_gpu_matches_cpu_with_moving_pressure_forcing() {
        use crate::physics::{GeoPoint, meteotsunami::MeteotsunamiSource};

        let mut cpu_grid = SwGrid::new(-0.4, -0.4, 0.4, 0.4, 0.05, 0.05);
        cpu_grid.fill_uniform_depth(155.0);
        let mut gpu_grid = cpu_grid.clone();
        let source = MeteotsunamiSource {
            peak_pressure_pa: 300.0,
            speed_m_s: 39.0,
            heading_deg: 90.0,
            along_track_sigma_m: 20_000.0,
            cross_track_sigma_m: 40_000.0,
            track_length_m: 200_000.0,
            water_depth_m: 155.0,
            location: GeoPoint { lat_deg: 0.0, lon_deg: -0.25, depth_m: 155.0 },
        };
        let dt = cpu_grid.recommended_dt_s(0.3);
        let mut cpu = TimeStepper::new(dt)
            .with_boundary(super::super::BoundaryMode::ZeroFlux);
        cpu.manning_n = 0.0;
        let gpu = match GpuTimeStepper::new(&gpu_grid, dt, 0.0, 0, true) {
            Some(gpu) => gpu,
            None => {
                println!("swe_gpu_matches_cpu_with_moving_pressure_forcing: no adapter — skipping");
                return;
            }
        };
        for _ in 0..12 {
            let midpoint = cpu_grid.t_s + 0.5 * dt;
            source.apply_pressure_gradient(&mut cpu_grid, midpoint, dt);
            cpu.step_one(&mut cpu_grid);
            assert!(gpu.step_with_pressure_forcing(&mut gpu_grid, &source, None));
        }
        let eta_error = cpu_grid
            .eta_m
            .iter()
            .zip(&gpu_grid.eta_m)
            .map(|(cpu, gpu)| (cpu - gpu).abs())
            .fold(0.0_f64, f64::max);
        assert!(eta_error < 1.0e-3, "forced GPU eta parity error was {eta_error}");
    }

    /// Full-physics parity: nonlinear advection + sponge boundary +
    /// Manning friction — the exact configuration `simulate_grid`
    /// dispatches. Locks the 2026-07-01 CPU/GPU eta-divergence fix
    /// (both paths share hydrostatic reconstruction and Rusanov fluxes). The
    /// tolerance is looser than the linear test because the GPU stores
    /// state in f32 and the upwind advection branch amplifies rounding.
    #[test]
    fn swe_gpu_matches_cpu_full_physics() {
        let mut g_cpu = SwGrid::new(-4.0, -4.0, 4.0, 4.0, 0.125, 0.125);
        g_cpu.fill_uniform_depth(4_000.0);
        g_cpu.inject_gaussian(0.0, 0.0, 2.0, 60_000.0);
        let mut g_gpu = g_cpu.clone();

        let dt = g_cpu.recommended_dt_s(0.3);
        let cpu = TimeStepper::new(dt); // default: nonlinear + sponge + Manning
        cpu.step(&mut g_cpu, 60);

        let sponge = super::super::BoundaryMode::DEFAULT_SPONGE_WIDTH as u32;
        let gpu = match GpuTimeStepper::new(
            &g_gpu,
            dt,
            crate::physics::constants::MANNING_N_COASTAL,
            sponge,
            true,
        ) {
            Some(g) => g,
            None => {
                println!("swe_gpu_matches_cpu_full_physics: no adapter — skipping");
                return;
            }
        };
        assert!(gpu.step(&mut g_gpu, 60), "GPU step reported failure");

        let mut max_diff = 0.0_f64;
        for (a, b) in g_cpu.eta_m.iter().zip(g_gpu.eta_m.iter()) {
            assert!(b.is_finite(), "GPU produced non-finite eta");
            max_diff = max_diff.max((a - b).abs());
        }
        assert!(
            max_diff < 5.0e-3,
            "full-physics GPU η disagrees with CPU η by {} m (> 5e-3, IC amplitude 2 m)",
            max_diff
        );
    }

    #[test]
    fn swe_gpu_matches_cpu_with_high_latitude_row_metrics() {
        let mut g_cpu = SwGrid::new(-8.0, 52.0, 8.0, 68.0, 0.25, 0.25);
        g_cpu.fill_uniform_depth(4_000.0);
        g_cpu.inject_gaussian(60.0, 0.0, 1.0, 100_000.0);
        let mut g_gpu = g_cpu.clone();

        let dt = g_cpu.recommended_dt_s(0.25);
        TimeStepper::new(dt).step(&mut g_cpu, 40);

        let gpu = match GpuTimeStepper::new(
            &g_gpu,
            dt,
            crate::physics::constants::MANNING_N_COASTAL,
            super::super::BoundaryMode::DEFAULT_SPONGE_WIDTH as u32,
            true,
        ) {
            Some(gpu) => gpu,
            None => {
                println!(
                    "swe_gpu_matches_cpu_with_high_latitude_row_metrics: no adapter — skipping"
                );
                return;
            }
        };
        assert!(gpu.step(&mut g_gpu, 40), "GPU step reported failure");

        let max_diff = g_cpu
            .eta_m
            .iter()
            .zip(&g_gpu.eta_m)
            .map(|(cpu, gpu)| (cpu - gpu).abs())
            .fold(0.0_f64, f64::max);
        assert!(
            max_diff < 5.0e-3,
            "high-latitude GPU eta differs from CPU by {max_diff} m"
        );
    }

    /// GPU kernel with sponge boundary should produce damped rim
    /// cells, matching the CPU sponge behavior.
    #[test]
    fn swe_gpu_sponge_damps_rim() {
        let mut g = SwGrid::new(-2.0, -2.0, 2.0, 2.0, 0.25, 0.25);
        g.fill_uniform_depth(4_000.0);
        g.inject_gaussian(0.0, 0.0, 1.0, 60_000.0);

        // CFL 0.3, matching the CPU sponge test: at 0.4 the explicit
        // A-grid scheme is marginally unstable over 200 steps and the
        // f32 GPU field goes non-finite before the f64 CPU one would.
        let dt = g.recommended_dt_s(0.3);
        let gpu = match GpuTimeStepper::new(&g, dt, 0.0, 5, false) {
            Some(g) => g,
            None => {
                println!("swe_gpu_sponge_damps_rim: no adapter — skipping");
                return;
            }
        };
        assert!(gpu.step(&mut g, 200), "GPU step reported failure");

        let corner = g.eta_m[super::super::idx(1, 1, g.nx)].abs();
        assert!(
            corner < 0.1,
            "corner cell {} m not absorbed by GPU sponge",
            corner
        );
    }

    #[test]
    fn swe_gpu_preserves_well_balanced_variable_bathymetry() {
        let mut cpu_grid = SwGrid::new(-2.0, -1.0, 2.0, 1.0, 0.25, 0.25);
        for j in 0..cpu_grid.ny {
            for i in 0..cpu_grid.nx {
                cpu_grid.h_m[super::super::idx(i, j, cpu_grid.nx)] = if i < cpu_grid.nx / 4 {
                    0.0
                } else {
                    20.0 + 100.0 * (i - cpu_grid.nx / 4) as f64
                };
            }
        }
        let mut gpu_grid = cpu_grid.clone();
        let dt = cpu_grid.recommended_dt_s(0.3);
        TimeStepper::new(dt)
            .with_boundary(super::super::BoundaryMode::ZeroFlux)
            .with_mode(SolverMode::Linear)
            .step(&mut cpu_grid, 50);

        let gpu = match GpuTimeStepper::new(&gpu_grid, dt, 0.0, 0, false) {
            Some(g) => g,
            None => {
                println!("swe_gpu_preserves_well_balanced_variable_bathymetry: no adapter — skipping");
                return;
            }
        };
        assert!(gpu.step(&mut gpu_grid, 50), "GPU step reported failure");

        for index in 0..cpu_grid.h_m.len() {
            let cpu_depth = cpu_grid.h_m[index] + cpu_grid.eta_m[index];
            let gpu_depth = gpu_grid.h_m[index] + gpu_grid.eta_m[index];
            assert_eq!(
                cpu_depth > super::super::WET_DEPTH_EPSILON_M,
                gpu_depth > super::super::WET_DEPTH_EPSILON_M,
                "wet-mask mismatch at {index}: CPU {cpu_depth}, GPU {gpu_depth}",
            );
        }
        assert!(gpu_grid.eta_m.iter().all(|eta| eta.abs() < 1.0e-5));
        assert!(gpu_grid.u_ms.iter().all(|velocity| velocity.abs() < 1.0e-4));
        assert!(gpu_grid.v_ms.iter().all(|velocity| velocity.abs() < 1.0e-4));
    }

    #[test]
    fn swe_gpu_dry_bed_front_matches_cpu_mask_and_fields() {
        let mut cpu_grid = SwGrid::new(-3.2, -0.2, 3.2, 0.2, 0.1, 0.1);
        cpu_grid.fill_uniform_depth(0.0);
        for j in 0..cpu_grid.ny {
            for i in 0..cpu_grid.nx / 2 {
                cpu_grid.eta_m[super::super::idx(i, j, cpu_grid.nx)] = 10.0;
            }
        }
        let mut gpu_grid = cpu_grid.clone();
        let dt = cpu_grid.recommended_dt_s(0.15);
        let mut cpu = TimeStepper::new(dt)
            .with_boundary(super::super::BoundaryMode::ZeroFlux)
            .with_mode(SolverMode::Linear);
        cpu.manning_n = 0.0;
        cpu.step(&mut cpu_grid, 8);
        let gpu = match GpuTimeStepper::new(&gpu_grid, dt, 0.0, 0, false) {
            Some(gpu) => gpu,
            None => {
                println!("swe_gpu_dry_bed_front_matches_cpu_mask_and_fields: no adapter — skipping");
                return;
            }
        };
        assert!(gpu.step(&mut gpu_grid, 8), "GPU step reported failure");

        for index in 0..cpu_grid.h_m.len() {
            let cpu_depth = cpu_grid.h_m[index] + cpu_grid.eta_m[index];
            let gpu_depth = gpu_grid.h_m[index] + gpu_grid.eta_m[index];
            assert_eq!(
                cpu_depth > super::super::WET_DEPTH_EPSILON_M,
                gpu_depth > super::super::WET_DEPTH_EPSILON_M,
                "wet-mask mismatch at {index}: CPU {cpu_depth}, GPU {gpu_depth}",
            );
        }
        let eta_error = cpu_grid
            .eta_m
            .iter()
            .zip(&gpu_grid.eta_m)
            .map(|(cpu, gpu)| (cpu - gpu).abs())
            .fold(0.0_f64, f64::max);
        assert!(eta_error < 2.0e-3, "dry-bed eta parity error was {eta_error}");
        assert!(gpu_grid.h_m.iter().zip(&gpu_grid.eta_m).all(|(h, eta)| h + eta >= 0.0));
    }
}
