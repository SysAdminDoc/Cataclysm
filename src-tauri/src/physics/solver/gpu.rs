//! GPU shallow-water solver path (F-V05). Compiles only with the
//! `gpu` cargo feature. Provides a parallel structure to the CPU
//! `TimeStepper`/`run_simulation` path so callers can opt into GPU
//! acceleration when an adapter is available.
//!
//! ## Status (v0.3.0 scaffold)
//!
//! - [x] wgpu + pollster deps wired behind `[features] gpu`.
//! - [x] `GpuTimeStepper` skeleton exposing the same `step / step_one`
//!       surface as the CPU `TimeStepper`.
//! - [x] WGSL kernel reused verbatim from [`super::kernels::SWE_LEAPFROG_WGSL`].
//! - [ ] Buffer-binding plumbing (ping-pong storage buffers for
//!       `h`, `eta`, `u`, `v`, dispatch loop). The next session lands
//!       this in batch v0.4.0; this scaffold establishes the module
//!       layout, dependency surface, and adapter-acquisition path so
//!       the rest is mechanical.
//!
//! ## Reference
//!
//! Qin, He, LeVeque, Mandli, & Berger (2019) — *Algorithms and Data
//! Structures for Cellular-Automata Tsunami Modeling on GPUs*, arXiv:
//! 1901.06798 — reports 3.6–6.4× speedup vs. 16-core CPU on GeoClaw.

use super::SwGrid;

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

/// GPU-side time stepper (skeleton). Constructed once per simulation
/// run; holds the wgpu device, queue, and compiled compute pipeline so
/// `step()` becomes a pure dispatch loop.
pub struct GpuTimeStepper {
    #[allow(dead_code)]
    pub dt_s: f64,
    #[allow(dead_code)]
    pub manning_n: f64,
}

impl GpuTimeStepper {
    /// Build the GPU pipeline for the given grid + dt. Returns `None`
    /// when no adapter is available — callers fall back to the CPU
    /// path. The full implementation lands in the v0.4.0 phase.
    pub fn new(_grid: &SwGrid, dt_s: f64, manning_n: f64) -> Option<Self> {
        match probe_adapter() {
            GpuAvailability::Available => Some(Self { dt_s, manning_n }),
            _ => None,
        }
    }

    /// Advance the grid by `n_steps` on the GPU. Currently a no-op
    /// scaffold; the v0.4.0 work fills in buffer creation, kernel
    /// dispatch, and result readback.
    pub fn step(&self, _grid: &mut SwGrid, _n_steps: usize) {
        // TODO(v0.4.0): wire up the WGSL kernel from
        // [`super::kernels::SWE_LEAPFROG_WGSL`] with ping-pong storage
        // buffers and dispatch ((nx+7)/8, (ny+7)/8) workgroups per step.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_adapter_returns_some_state() {
        // We don't assert availability — CI runners often lack a GPU.
        // The probe must at least return without panicking.
        let _ = probe_adapter();
    }
}
