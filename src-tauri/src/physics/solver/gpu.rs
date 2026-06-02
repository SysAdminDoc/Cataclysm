//! GPU shallow-water solver path (F-V05 / F4-01). Compiles only with
//! the `gpu` cargo feature. Provides a parallel structure to the CPU
//! `TimeStepper`/`run_simulation` path so callers can opt into GPU
//! acceleration when an adapter is available.
//!
//! ## Status (v0.4.0)
//!
//! - [x] wgpu + pollster deps wired behind `[features] gpu`.
//! - [x] `GpuTimeStepper` exposing `step` matching the CPU surface.
//! - [x] WGSL kernel reused verbatim from [`super::kernels::SWE_LEAPFROG_WGSL`].
//! - [x] Buffer-binding plumbing (ping-pong storage buffers for
//!       `h`, `eta`, `u`, `v`) + dispatch loop + result readback.
//! - [x] Restartable across multiple `step` calls: the eta/u/v fields
//!       are re-uploaded from the host-side `grid` at the start of
//!       each call and read back at the end, so successive calls
//!       compose just like the CPU `TimeStepper::step`.
//! - [ ] Manning friction + advection branch — current kernel matches
//!       the v0.3.0 linear-SWE form; nonlinear advection (F4-02) is
//!       CPU-only for now. Add to WGSL kernel in v0.5.0 once we have
//!       a regression harness for GPU-vs-CPU agreement on a NSWE
//!       scenario.
//!
//! ## Reference
//!
//! Qin, He, LeVeque, Mandli, & Berger (2019) — *Algorithms and Data
//! Structures for Cellular-Automata Tsunami Modeling on GPUs*, arXiv:
//! 1901.06798 — reports 3.6–6.4× speedup vs. 16-core CPU on GeoClaw.

use super::kernels::SWE_LEAPFROG_WGSL;
use super::SwGrid;
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

/// 32-byte Params struct matching the WGSL `struct Params` layout in
/// [`SWE_LEAPFROG_WGSL`].
#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct GpuParams {
    dx_m: f32,
    dy_m: f32,
    dt_s: f32,
    g: f32,
    manning_n: f32,
    nx: u32,
    ny: u32,
    _pad: u32,
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
    pub fn new(grid: &SwGrid, dt_s: f64, manning_n: f64) -> Option<Self> {
        pollster::block_on(Self::new_async(grid, dt_s, manning_n))
    }

    async fn new_async(grid: &SwGrid, dt_s: f64, manning_n: f64) -> Option<Self> {
        let instance = wgpu::Instance::default();
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .ok()?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("tsunamisim-swe"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::downlevel_defaults(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
            })
            .await
            .ok()?;

        let n_cells = grid.nx * grid.ny;
        let n_bytes = (n_cells * std::mem::size_of::<f32>()) as wgpu::BufferAddress;

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("swe-leapfrog"),
            source: wgpu::ShaderSource::Wgsl(SWE_LEAPFROG_WGSL.into()),
        });

        let (lon_m, lat_m) = grid.metres_per_deg();
        let dx_m = lon_m * grid.dlon_deg;
        let dy_m = lat_m * grid.dlat_deg;
        let params = GpuParams {
            dx_m: dx_m as f32,
            dy_m: dy_m as f32,
            dt_s: dt_s as f32,
            g: super::super::constants::G_EARTH as f32,
            manning_n: manning_n as f32,
            nx: grid.nx as u32,
            ny: grid.ny as u32,
            _pad: 0,
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
        let storage_usage =
            wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC | wgpu::BufferUsages::COPY_DST;
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
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("swe-pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("cs_leapfrog"),
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
        pollster::block_on(self.step_async(grid, n_steps))
    }

    async fn step_async(&self, grid: &mut SwGrid, n_steps: usize) -> bool {
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

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
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
        if self.device.poll(wgpu::PollType::Wait).is_err() {
            eprintln!("[gpu] device.poll failed during readback — aborting GPU step");
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
                true
            }
            _ => {
                eprintln!("[gpu] readback failed or produced non-finite field — aborting GPU step");
                false
            }
        }
    }

    fn make_bg(&self, a_is_in: bool) -> wgpu::BindGroup {
        let (eta_in, eta_out, u_in, u_out, v_in, v_out) = if a_is_in {
            (&self.eta_a, &self.eta_b, &self.u_a, &self.u_b, &self.v_a, &self.v_b)
        } else {
            (&self.eta_b, &self.eta_a, &self.u_b, &self.u_a, &self.v_b, &self.v_a)
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
    /// linear-SWE leapfrog should agree with the CPU linear-SWE
    /// leapfrog to within 1e-3 m on η across the grid after a
    /// short run. f32 vs f64 introduces ~1e-7 round-off per step;
    /// 50 leapfrog steps × cancellation noise comfortably fits in
    /// 1e-3 even on a downlevel adapter.
    ///
    /// CI runners that lack a GPU silently no-op (the test
    /// returns early when `GpuTimeStepper::new` yields `None`).
    /// A regression on real hardware will surface immediately.
    #[test]
    fn swe_gpu_matches_cpu() {
        let mut g_cpu = SwGrid::new(-2.0, -2.0, 2.0, 2.0, 0.25, 0.25);
        g_cpu.fill_uniform_depth(4_000.0);
        g_cpu.inject_gaussian(0.0, 0.0, 1.0, 60_000.0);
        let mut g_gpu = g_cpu.clone();

        let dt = g_cpu.recommended_dt_s(0.4);
        let cpu = TimeStepper::new(dt).with_mode(SolverMode::Linear);
        // Match the WGSL kernel's reflective-edge convention exactly
        // by running the CPU in `ZeroFlux` mode.
        let cpu = cpu.with_boundary(super::super::BoundaryMode::ZeroFlux);
        cpu.step(&mut g_cpu, 50);

        let gpu = match GpuTimeStepper::new(&g_gpu, dt, 0.0) {
            Some(g) => g,
            None => {
                eprintln!("swe_gpu_matches_cpu: no adapter — skipping");
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
}
