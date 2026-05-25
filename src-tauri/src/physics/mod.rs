//! Physics for tsunami generation, propagation, and runup.
//!
//! ## Source models (initial water-surface displacement)
//! - [`asteroid`] — Ward & Asphaug 2000, Schmidt & Holsapple 1982 cavity scaling.
//! - [`nuclear`]  — Glasstone & Dolan 1977 + Le Méhauté 1996 + DNA 1996 efficiency.
//! - [`landslide`] — Fritz & Hager 2001 (Lituya); Slingerland & Voight.
//! - [`earthquake`] — Okada 1985 fault dislocation (scaffold).
//!
//! ## Propagation + runup
//! - [`shallow_water`] — linear long-wave dispersion, Synolakis 1987 runup,
//!   NSWE solver scaffold.
//!
//! All public functions return SI units unless explicitly suffixed otherwise.
//! Function-level comments include the source paper and the formula being
//! evaluated so the math is auditable without consulting the citations file.

pub mod constants;
pub mod asteroid;
pub mod nuclear;
pub mod landslide;
pub mod earthquake;
pub mod okada;
pub mod lamb_wave;
pub mod shallow_water;
pub mod solver;
#[cfg(feature = "validation")]
pub mod validation;

use serde::{Deserialize, Serialize};

/// A point on Earth's surface (WGS84, degrees, with sea-level reference).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct GeoPoint {
    pub lat_deg: f64,
    pub lon_deg: f64,
    /// Local water depth at this point, in meters (positive = below sea level).
    /// 0.0 for land; bathymetry not yet sampled in this scaffold.
    #[serde(default)]
    pub depth_m: f64,
}

/// A camera framing for the Cesium `flyTo` when this source is selected.
/// Optional per-preset override of the heuristic auto-clamp; useful for
/// confined scenarios (Lituya Bay fjord wants a 50 km tight view) and
/// for global ones (Chicxulub wants a continent-wide view).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CameraView {
    pub heading_deg: f64,
    pub pitch_deg: f64,
    pub range_m: f64,
}

/// Snapshot of the initial water-surface displacement for the source.
///
/// This is the "t=0" condition that propagation solvers operate on.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitialDisplacement {
    pub center: GeoPoint,
    /// Effective cavity / disturbance radius, in meters.
    pub cavity_radius_m: f64,
    /// Peak amplitude (positive = up) at the source, in meters.
    pub peak_amplitude_m: f64,
    /// Total kinetic + potential energy delivered to the ocean, in joules.
    pub source_energy_j: f64,
    /// Equivalent surface earthquake moment magnitude (seismic equivalent).
    pub seismic_mw_equivalent: f64,
    /// Optional dominant wavelength, in meters (impact tsunamis: ≈ 2 × cavity radius).
    #[serde(default)]
    pub dominant_wavelength_m: Option<f64>,
    /// Human-readable description of the source.
    pub label: String,
    /// Optional curated camera framing populated by `run_preset` for
    /// historical presets. Custom scenarios leave this `None` and the
    /// frontend falls back to its heuristic auto-clamp.
    #[serde(default)]
    pub camera_view: Option<CameraView>,
}
