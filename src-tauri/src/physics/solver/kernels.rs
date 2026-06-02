//! WGSL kernel source code, embedded as a string constant. When the crate is
//! built with `--features gpu` this is compiled into a `wgpu::ShaderModule`
//! and dispatched by [`super::gpu::GpuTimeStepper`].
//!
//! The kernel implements one leapfrog step of the depth-averaged shallow-water
//! equations on a regular lat-lon grid. Data layout is **collocated** (A-grid),
//! all quantities in flat `array<f32>` storage buffers (not textures, not a
//! staggered C-grid): bindings 1-4 read `h`/`η`/`u`/`v`, bindings 5-7 write the
//! updated `(η, u, v)`.
//!
//! NOTE: this kernel intentionally implements only the *linear* momentum form
//! with reflective (zero-normal-flux) edges and **no** land masking or sponge
//! damping — unlike the CPU [`super::TimeStepper`] default
//! (`SolverMode::Nonlinear` + `BoundaryMode::Sponge` + `LAND_DEPTH_THRESHOLD_M`
//! masking). The dispatcher (`commands::run_simulation_dispatch`) therefore only
//! routes a run to the GPU when those CPU-only features are not in play; see
//! that function before porting work here.

/// Linear leapfrog SWE update kernel. Workgroup size 8×8 (64 invocations) over
/// an `(nx, ny)` collocated grid. Boundary cells reflect (zero-normal-flux).
pub const SWE_LEAPFROG_WGSL: &str = r#"
// TsunamiSimulator — shallow-water leapfrog kernel (linear, collocated A-grid)
// Reference: Mader 1988 "Numerical Modelling of Water Waves", chapter 3
// Reference: Kowalik & Murty 1993 "Numerical Modeling of Ocean Dynamics"

struct Params {
  dx_m: f32,
  dy_m: f32,
  dt_s: f32,
  g: f32,
  manning_n: f32,
  nx: u32,
  ny: u32,
  _pad: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read>     h:     array<f32>;      // bathymetry
@group(0) @binding(2) var<storage, read>     eta_in: array<f32>;
@group(0) @binding(3) var<storage, read>     u_in:   array<f32>;
@group(0) @binding(4) var<storage, read>     v_in:   array<f32>;
@group(0) @binding(5) var<storage, read_write> eta_out: array<f32>;
@group(0) @binding(6) var<storage, read_write> u_out:   array<f32>;
@group(0) @binding(7) var<storage, read_write> v_out:   array<f32>;

fn idx(i: i32, j: i32) -> i32 {
  return j * i32(params.nx) + i;
}

@compute @workgroup_size(8, 8)
fn cs_leapfrog(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = i32(gid.x);
  let j = i32(gid.y);
  if (i >= i32(params.nx) || j >= i32(params.ny)) { return; }

  // Reflective boundaries: zero-flux outside grid.
  if (i == 0 || i == i32(params.nx) - 1 || j == 0 || j == i32(params.ny) - 1) {
    eta_out[idx(i, j)] = eta_in[idx(i, j)];
    u_out[idx(i, j)]   = 0.0;
    v_out[idx(i, j)]   = 0.0;
    return;
  }

  let dx = params.dx_m;
  let dy = params.dy_m;
  let dt = params.dt_s;
  let g  = params.g;

  // Continuity: ∂η/∂t = -∂(Hu)/∂x - ∂(Hv)/∂y
  let h_e = h[idx(i + 1, j)];   let h_w = h[idx(i - 1, j)];
  let h_n = h[idx(i, j + 1)];   let h_s = h[idx(i, j - 1)];
  let u_e = u_in[idx(i + 1, j)]; let u_w = u_in[idx(i - 1, j)];
  let v_n = v_in[idx(i, j + 1)]; let v_s = v_in[idx(i, j - 1)];

  let flux_x = ((h_e + eta_in[idx(i + 1, j)]) * u_e -
                (h_w + eta_in[idx(i - 1, j)]) * u_w) / (2.0 * dx);
  let flux_y = ((h_n + eta_in[idx(i, j + 1)]) * v_n -
                (h_s + eta_in[idx(i, j - 1)]) * v_s) / (2.0 * dy);

  eta_out[idx(i, j)] = eta_in[idx(i, j)] - dt * (flux_x + flux_y);

  // Momentum (linearised, no Coriolis, no advection in v0.2.0 first cut):
  // ∂u/∂t = -g ∂η/∂x - friction
  // ∂v/∂t = -g ∂η/∂y - friction
  let dnedx = (eta_in[idx(i + 1, j)] - eta_in[idx(i - 1, j)]) / (2.0 * dx);
  let dnedy = (eta_in[idx(i, j + 1)] - eta_in[idx(i, j - 1)]) / (2.0 * dy);

  let H = max(h[idx(i, j)] + eta_in[idx(i, j)], 0.01);
  let u = u_in[idx(i, j)];
  let v = v_in[idx(i, j)];
  let speed = sqrt(u * u + v * v);
  let n2 = params.manning_n * params.manning_n;
  let fric = g * n2 * speed / pow(H, 1.333);

  u_out[idx(i, j)] = u - dt * (g * dnedx + fric * u);
  v_out[idx(i, j)] = v - dt * (g * dnedy + fric * v);
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kernel_source_is_nonempty() {
        // Sanity-check that the embedded WGSL string is present so the next
        // session can pipe it into wgpu::ShaderModuleDescriptor.
        assert!(SWE_LEAPFROG_WGSL.len() > 500);
        assert!(SWE_LEAPFROG_WGSL.contains("cs_leapfrog"));
        assert!(SWE_LEAPFROG_WGSL.contains("workgroup_size(8, 8)"));
    }
}
