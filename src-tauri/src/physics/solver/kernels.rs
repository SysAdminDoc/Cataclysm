//! WGSL kernel source for the GPU shallow-water stepper.
//!
//! The kernel mirrors the CPU hydrostatic-reconstruction/Rusanov update on a
//! collocated latitude/longitude grid. It advances total depth and conserved
//! momenta, applies the same spherical metrics and semi-implicit Manning drag,
//! and converts back to surface elevation plus depth-averaged velocity.

/// Positivity-preserving, well-balanced SWE kernel. Workgroup size 8x8 over an
/// `(nx, ny)` collocated grid.
pub const SWE_FINITE_VOLUME_WGSL: &str = r#"
// Cataclysm shallow-water finite-volume kernel.
// Hydrostatic reconstruction: Audusse et al. 2004.
// Numerical flux: local Lax-Friedrichs (Rusanov).

struct Params {
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
};

struct FaceFlux {
  mass: f32,
  normal_left: f32,
  normal_right: f32,
  tangential: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var<storage, read> eta_in: array<f32>;
@group(0) @binding(3) var<storage, read> u_in: array<f32>;
@group(0) @binding(4) var<storage, read> v_in: array<f32>;
@group(0) @binding(5) var<storage, read_write> eta_out: array<f32>;
@group(0) @binding(6) var<storage, read_write> u_out: array<f32>;
@group(0) @binding(7) var<storage, read_write> v_out: array<f32>;

fn idx(i: i32, j: i32) -> i32 {
  return j * i32(params.nx) + i;
}

fn total_depth(k: i32) -> f32 {
  return max(h[k] + eta_in[k], 0.0);
}

fn row_lat_rad(j: i32) -> f32 {
  return params.south_lat_rad + (f32(j) + 0.5) * params.dlat_rad;
}

fn row_cos_lat(j: i32) -> f32 {
  return max(abs(cos(row_lat_rad(j))), 1.17549435e-38);
}

fn face_cos_lat(face: i32) -> f32 {
  return abs(cos(params.south_lat_rad + f32(face) * params.dlat_rad));
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

fn hydrostatic_face_flux(
  left: i32,
  right: i32,
  normal_velocity_left_raw: f32,
  tangential_velocity_left_raw: f32,
  normal_velocity_right_raw: f32,
  tangential_velocity_right_raw: f32,
) -> FaceFlux {
  let face_bed_elevation = max(-h[left], -h[right]);
  let depth_left = max(eta_in[left] - face_bed_elevation, 0.0);
  let depth_right = max(eta_in[right] - face_bed_elevation, 0.0);
  let raw_depth_left = total_depth(left);
  let raw_depth_right = total_depth(right);
  let wet_left = raw_depth_left > params.wet_depth_epsilon_m;
  let wet_right = raw_depth_right > params.wet_depth_epsilon_m;
  let normal_velocity_left = select(0.0, normal_velocity_left_raw, wet_left);
  let tangential_velocity_left = select(0.0, tangential_velocity_left_raw, wet_left);
  let normal_velocity_right = select(0.0, normal_velocity_right_raw, wet_right);
  let tangential_velocity_right = select(0.0, tangential_velocity_right_raw, wet_right);
  let normal_discharge_left = depth_left * normal_velocity_left;
  let normal_discharge_right = depth_right * normal_velocity_right;
  let tangential_discharge_left = depth_left * tangential_velocity_left;
  let tangential_discharge_right = depth_right * tangential_velocity_right;
  let signal_speed = max(
    abs(normal_velocity_left) + sqrt(params.g * depth_left),
    abs(normal_velocity_right) + sqrt(params.g * depth_right),
  );
  let mass = 0.5 * (normal_discharge_left + normal_discharge_right)
    - 0.5 * signal_speed * (depth_right - depth_left);
  var advective_normal_left = 0.0;
  var advective_normal_right = 0.0;
  var advective_tangential = 0.0;
  if (params.nonlinear != 0u) {
    advective_normal_left = normal_discharge_left * normal_velocity_left;
    advective_normal_right = normal_discharge_right * normal_velocity_right;
    advective_tangential = normal_discharge_left * tangential_velocity_left
      + normal_discharge_right * tangential_velocity_right;
  }
  let shared_normal = 0.5 * (
      advective_normal_left + 0.5 * params.g * depth_left * depth_left
      + advective_normal_right + 0.5 * params.g * depth_right * depth_right
    ) - 0.5 * signal_speed * (normal_discharge_right - normal_discharge_left);
  let tangential = 0.5 * advective_tangential
    - 0.5 * signal_speed * (tangential_discharge_right - tangential_discharge_left);
  return FaceFlux(
    mass,
    shared_normal + 0.5 * params.g * (raw_depth_left * raw_depth_left - depth_left * depth_left),
    shared_normal + 0.5 * params.g * (raw_depth_right * raw_depth_right - depth_right * depth_right),
    tangential,
  );
}

@compute @workgroup_size(8, 8)
fn cs_finite_volume(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = i32(gid.x);
  let j = i32(gid.y);
  if (i >= i32(params.nx) || j >= i32(params.ny)) { return; }
  let k = idx(i, j);
  let sf = sponge_factor(i, j);

  if (i == 0 || i == i32(params.nx) - 1 || j == 0 || j == i32(params.ny) - 1) {
    let next_eta = eta_in[k] * sf;
    let next_depth = max(h[k] + next_eta, 0.0);
    eta_out[k] = next_depth - h[k];
    u_out[k] = 0.0;
    v_out[k] = 0.0;
    return;
  }

  let east = idx(i + 1, j);
  let west = idx(i - 1, j);
  let north = idx(i, j + 1);
  let south = idx(i, j - 1);
  let flux_east = hydrostatic_face_flux(k, east, u_in[k], v_in[k], u_in[east], v_in[east]);
  let flux_west = hydrostatic_face_flux(west, k, u_in[west], v_in[west], u_in[k], v_in[k]);
  let flux_north = hydrostatic_face_flux(k, north, v_in[k], u_in[k], v_in[north], u_in[north]);
  let flux_south = hydrostatic_face_flux(south, k, v_in[south], u_in[south], v_in[k], u_in[k]);

  let dx = row_dx_m(j);
  let dy = max(params.earth_radius_m * abs(params.dlat_rad), 1.17549435e-38);
  let cos_lat = row_cos_lat(j);
  let cos_north = face_cos_lat(j + 1);
  let cos_south = face_cos_lat(j);
  let divergence_mass_x = (flux_east.mass - flux_west.mass) / dx;
  let divergence_mass_y = (flux_north.mass * cos_north - flux_south.mass * cos_south)
    / (dy * cos_lat);
  let current_depth = total_depth(k);
  let updated_depth = max(current_depth - params.dt_s * (divergence_mass_x + divergence_mass_y), 0.0);
  var next_eta = updated_depth - h[k];
  var next_u = 0.0;
  var next_v = 0.0;

  if (updated_depth > params.wet_depth_epsilon_m) {
    let current_wet = current_depth > params.wet_depth_epsilon_m;
    let current_u = select(0.0, u_in[k], current_wet);
    let current_v = select(0.0, v_in[k], current_wet);
    let current_qx = current_depth * current_u;
    let current_qy = current_depth * current_v;
    let divergence_qx_x = (flux_east.normal_left - flux_west.normal_right) / dx;
    let divergence_qx_y = (flux_north.tangential * cos_north - flux_south.tangential * cos_south)
      / (dy * cos_lat);
    let divergence_qy_x = (flux_east.tangential - flux_west.tangential) / dx;
    let divergence_qy_y = (flux_north.normal_left * cos_north - flux_south.normal_right * cos_south)
      / (dy * cos_lat);
    let pressure_metric = 0.5 * params.g * current_depth * current_depth
      * (cos_north - cos_south) / (dy * cos_lat);
    next_u = (current_qx - params.dt_s * (divergence_qx_x + divergence_qx_y)) / updated_depth;
    next_v = (current_qy - params.dt_s * (divergence_qy_x + divergence_qy_y - pressure_metric))
      / updated_depth;
    if (params.nonlinear != 0u) {
      let tan_over_radius = tan(row_lat_rad(j)) / params.earth_radius_m;
      next_u += params.dt_s * next_u * next_v * tan_over_radius;
      next_v -= params.dt_s * next_u * next_u * tan_over_radius;
    }
    let speed = sqrt(next_u * next_u + next_v * next_v);
    let friction = params.g * params.manning_n * params.manning_n * speed
      / pow(max(updated_depth, params.wet_depth_epsilon_m), 1.3333333333);
    let damping = 1.0 + params.dt_s * friction;
    next_u /= damping;
    next_v /= damping;
  }

  next_eta *= sf;
  next_u *= sf;
  next_v *= sf;
  let final_depth = max(h[k] + next_eta, 0.0);
  eta_out[k] = final_depth - h[k];
  if (final_depth <= params.wet_depth_epsilon_m) {
    u_out[k] = 0.0;
    v_out[k] = 0.0;
  } else {
    u_out[k] = next_u;
    v_out[k] = next_v;
  }
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kernel_source_is_nonempty() {
        assert!(SWE_FINITE_VOLUME_WGSL.len() > 500);
        assert!(SWE_FINITE_VOLUME_WGSL.contains("cs_finite_volume"));
        assert!(SWE_FINITE_VOLUME_WGSL.contains("workgroup_size(8, 8)"));
    }

    #[test]
    fn kernel_contains_dynamic_wet_dry_and_positivity() {
        assert!(SWE_FINITE_VOLUME_WGSL.contains("wet_depth_epsilon_m"));
        assert!(SWE_FINITE_VOLUME_WGSL.contains("final_depth"));
        assert!(SWE_FINITE_VOLUME_WGSL.contains("max(h[k] + next_eta, 0.0)"));
    }

    #[test]
    fn kernel_contains_hydrostatic_rusanov_flux() {
        assert!(SWE_FINITE_VOLUME_WGSL.contains("hydrostatic_face_flux"));
        assert!(SWE_FINITE_VOLUME_WGSL.contains("face_bed_elevation"));
        assert!(SWE_FINITE_VOLUME_WGSL.contains("signal_speed"));
        assert!(SWE_FINITE_VOLUME_WGSL.contains("normal_left"));
    }

    #[test]
    fn kernel_contains_sponge_damping() {
        assert!(SWE_FINITE_VOLUME_WGSL.contains("sponge_factor"));
        assert!(SWE_FINITE_VOLUME_WGSL.contains("sponge_width"));
    }

    #[test]
    fn kernel_contains_nonlinear_transport() {
        assert!(SWE_FINITE_VOLUME_WGSL.contains("params.nonlinear"));
        assert!(SWE_FINITE_VOLUME_WGSL.contains("advective_normal_left"));
        assert!(SWE_FINITE_VOLUME_WGSL.contains("advective_tangential"));
    }

    #[test]
    fn kernel_contains_row_aware_spherical_metrics() {
        assert!(SWE_FINITE_VOLUME_WGSL.contains("south_lat_rad"));
        assert!(SWE_FINITE_VOLUME_WGSL.contains("row_dx_m(j)"));
        assert!(SWE_FINITE_VOLUME_WGSL.contains("face_cos_lat(j + 1)"));
        assert!(SWE_FINITE_VOLUME_WGSL.contains("pressure_metric"));
        assert!(SWE_FINITE_VOLUME_WGSL.contains("tan_over_radius"));
    }
}
