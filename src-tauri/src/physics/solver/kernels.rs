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
//! The kernel now matches the CPU `TimeStepper` feature set:
//! - Land masking (cells with h <= land_threshold are pinned to zero)
//! - Sponge boundary (cosine-tapered damping at edges)
//! - Nonlinear advection (upwind-differenced (u·∇)u, toggled by params.nonlinear)

/// Full SWE leapfrog kernel with land masking, sponge boundary, and
/// nonlinear advection. Workgroup size 8×8 (64 invocations) over an
/// `(nx, ny)` collocated grid.
pub const SWE_LEAPFROG_WGSL: &str = r#"
// TsunamiSimulator — shallow-water leapfrog kernel (full-parity with CPU solver)
// Reference: Mader 1988 "Numerical Modelling of Water Waves", chapter 3
// Reference: Kowalik & Murty 1993 "Numerical Modeling of Ocean Dynamics"

struct Params {
  dlon_rad: f32,
  dlat_rad: f32,
  south_lat_rad: f32,
  earth_radius_m: f32,
  dt_s: f32,
  g: f32,
  manning_n: f32,
  land_threshold_m: f32,
  nx: u32,
  ny: u32,
  sponge_width: u32,
  nonlinear: u32,
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

fn is_wet(i: i32, j: i32) -> bool {
  return h[idx(i, j)] > params.land_threshold_m;
}

fn row_lat_rad(j: i32) -> f32 {
  return params.south_lat_rad + (f32(j) + 0.5) * params.dlat_rad;
}

fn row_cos_lat(j: i32) -> f32 {
  return max(abs(cos(row_lat_rad(j))), 1.17549435e-38);
}

fn row_dx_m(j: i32) -> f32 {
  return max(params.earth_radius_m * abs(params.dlon_rad) * row_cos_lat(j), 1.17549435e-38);
}

fn sponge_factor(i: i32, j: i32) -> f32 {
  let sw = i32(params.sponge_width);
  if (sw <= 0) { return 1.0; }
  let d_i = min(i, i32(params.nx) - 1 - i);
  let d_j = min(j, i32(params.ny) - 1 - j);
  let d = min(d_i, d_j);
  if (d >= sw) { return 1.0; }
  let t = f32(d) / f32(sw);
  return 0.5 * (1.0 - cos(3.14159265 * t));
}

@compute @workgroup_size(8, 8)
fn cs_leapfrog(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = i32(gid.x);
  let j = i32(gid.y);
  if (i >= i32(params.nx) || j >= i32(params.ny)) { return; }

  let k = idx(i, j);

  // Land cells: pin to zero.
  if (!is_wet(i, j)) {
    eta_out[k] = 0.0;
    u_out[k] = 0.0;
    v_out[k] = 0.0;
    return;
  }

  // Boundary cells: zero-flux.
  if (i == 0 || i == i32(params.nx) - 1 || j == 0 || j == i32(params.ny) - 1) {
    eta_out[k] = eta_in[k];
    u_out[k] = 0.0;
    v_out[k] = 0.0;
    return;
  }

  let dx = row_dx_m(j);
  let dy = max(params.earth_radius_m * abs(params.dlat_rad), 1.17549435e-38);
  let dt = params.dt_s;
  let g  = params.g;

  // Land-aware neighbour sampling: dry neighbours contribute zero flux.
  let wet_e = is_wet(i + 1, j);
  let wet_w = is_wet(i - 1, j);
  let wet_n = is_wet(i, j + 1);
  let wet_s = is_wet(i, j - 1);

  let h_e = select(0.0, h[idx(i + 1, j)], wet_e);
  let h_w = select(0.0, h[idx(i - 1, j)], wet_w);
  let h_n = select(0.0, h[idx(i, j + 1)], wet_n);
  let h_s = select(0.0, h[idx(i, j - 1)], wet_s);

  let eta_e = select(0.0, eta_in[idx(i + 1, j)], wet_e);
  let eta_w = select(0.0, eta_in[idx(i - 1, j)], wet_w);
  let eta_n = select(0.0, eta_in[idx(i, j + 1)], wet_n);
  let eta_s = select(0.0, eta_in[idx(i, j - 1)], wet_s);

  let u_e = select(0.0, u_in[idx(i + 1, j)], wet_e);
  let u_w = select(0.0, u_in[idx(i - 1, j)], wet_w);
  let v_n = select(0.0, v_in[idx(i, j + 1)], wet_n);
  let v_s = select(0.0, v_in[idx(i, j - 1)], wet_s);

  // Spherical continuity: the meridional face flux is weighted by its
  // latitude circumference and normalized by the current row circumference.
  let flux_x = (max(h_e + eta_e, 0.0) * u_e - max(h_w + eta_w, 0.0) * u_w) / (2.0 * dx);
  let flux_y = (max(h_n + eta_n, 0.0) * v_n * row_cos_lat(j + 1)
              - max(h_s + eta_s, 0.0) * v_s * row_cos_lat(j - 1))
              / (2.0 * dy * row_cos_lat(j));

  var new_eta = eta_in[k] - dt * (flux_x + flux_y);

  // Momentum: ∂u/∂t + [advection] + g ∂η/∂x = − friction
  let dnedx = (eta_in[idx(i + 1, j)] - eta_in[idx(i - 1, j)]) / (2.0 * dx);
  let dnedy = (eta_in[idx(i, j + 1)] - eta_in[idx(i, j - 1)]) / (2.0 * dy);

  let H = max(h[k] + eta_in[k], 0.01);
  let u = u_in[k];
  let v = v_in[k];
  let speed = sqrt(u * u + v * v);
  let n2 = params.manning_n * params.manning_n;
  let fric = g * n2 * speed / pow(H, 1.333);

  // Nonlinear advection: upwind-differenced (u·∇)u
  var adv_u = 0.0;
  var adv_v = 0.0;
  if (params.nonlinear != 0u) {
    let u_east = select(0.0, u_in[idx(i + 1, j)], wet_e);
    let u_west = select(0.0, u_in[idx(i - 1, j)], wet_w);
    let u_north = select(0.0, u_in[idx(i, j + 1)], wet_n);
    let u_south = select(0.0, u_in[idx(i, j - 1)], wet_s);
    let v_east = select(0.0, v_in[idx(i + 1, j)], wet_e);
    let v_west = select(0.0, v_in[idx(i - 1, j)], wet_w);
    let v_north = select(0.0, v_in[idx(i, j + 1)], wet_n);
    let v_south = select(0.0, v_in[idx(i, j - 1)], wet_s);

    // Upwind: backward gradient when velocity points positive, forward when negative
    let dudx = select((u_east - u) / dx, (u - u_west) / dx, u >= 0.0);
    let dudy = select((u_north - u) / dy, (u - u_south) / dy, v >= 0.0);
    let dvdx = select((v_east - v) / dx, (v - v_west) / dx, u >= 0.0);
    let dvdy = select((v_north - v) / dy, (v - v_south) / dy, v >= 0.0);

    let tan_over_radius = tan(row_lat_rad(j)) / params.earth_radius_m;

    adv_u = u * dudx + v * dudy - u * v * tan_over_radius;
    adv_v = u * dvdx + v * dvdy + u * u * tan_over_radius;
  }

  var new_u = u - dt * (adv_u + g * dnedx + fric * u);
  var new_v = v - dt * (adv_v + g * dnedy + fric * v);

  // Sponge boundary damping
  let sf = sponge_factor(i, j);
  new_eta *= sf;
  new_u *= sf;
  new_v *= sf;

  eta_out[k] = new_eta;
  u_out[k] = new_u;
  v_out[k] = new_v;
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kernel_source_is_nonempty() {
        assert!(SWE_LEAPFROG_WGSL.len() > 500);
        assert!(SWE_LEAPFROG_WGSL.contains("cs_leapfrog"));
        assert!(SWE_LEAPFROG_WGSL.contains("workgroup_size(8, 8)"));
    }

    #[test]
    fn kernel_contains_land_masking() {
        assert!(SWE_LEAPFROG_WGSL.contains("is_wet"));
        assert!(SWE_LEAPFROG_WGSL.contains("land_threshold_m"));
    }

    #[test]
    fn kernel_contains_sponge_damping() {
        assert!(SWE_LEAPFROG_WGSL.contains("sponge_factor"));
        assert!(SWE_LEAPFROG_WGSL.contains("sponge_width"));
    }

    #[test]
    fn kernel_contains_nonlinear_advection() {
        assert!(SWE_LEAPFROG_WGSL.contains("nonlinear"));
        assert!(SWE_LEAPFROG_WGSL.contains("adv_u"));
        assert!(SWE_LEAPFROG_WGSL.contains("adv_v"));
    }

    #[test]
    fn kernel_contains_row_aware_spherical_metrics() {
        assert!(SWE_LEAPFROG_WGSL.contains("south_lat_rad"));
        assert!(SWE_LEAPFROG_WGSL.contains("row_dx_m(j)"));
        assert!(SWE_LEAPFROG_WGSL.contains("row_cos_lat(j + 1)"));
        assert!(SWE_LEAPFROG_WGSL.contains("tan_over_radius"));
    }
}
