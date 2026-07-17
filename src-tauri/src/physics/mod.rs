//! Physics for tsunami generation, propagation, and runup.
//!
//! ## Source models (initial water-surface displacement)
//! - [`asteroid`] — Ward & Asphaug 2000, Schmidt & Holsapple 1982 cavity scaling.
//! - [`nuclear`]  — Glasstone & Dolan 1977 + Le Méhauté 1996 + DNA 1996 efficiency.
//! - [`landslide`] — Fritz & Hager 2001 (Lituya); Slingerland & Voight.
//! - [`earthquake`] — Okada 1985 fault dislocation (see [`okada`]).
//! - [`meteotsunami`] — translating atmospheric-pressure gradient forcing.
//!
//! ## Propagation + runup
//! - [`shallow_water`] — linear long-wave dispersion, Synolakis 1987 runup,
//!   NSWE solver scaffold.
//!
//! All public functions return SI units unless explicitly suffixed otherwise.
//! Function-level comments include the source paper and the formula being
//! evaluated so the math is auditable without consulting the citations file.

pub mod constants;
#[cfg(not(feature = "browser-wasm"))]
pub mod direct_hazard;
#[cfg(not(feature = "browser-wasm"))]
pub mod direct_hazard_probe;
pub mod asteroid;
pub mod nuclear;
pub mod landslide;
pub mod earthquake;
pub mod okada;
#[cfg(not(feature = "browser-wasm"))]
pub mod lamb_wave;
pub mod meteotsunami;
pub mod screening;
pub mod shallow_water;
#[cfg(not(feature = "browser-wasm"))]
pub mod solver;
#[cfg(all(test, not(feature = "browser-wasm")))]
mod property_tests;
#[cfg(all(feature = "validation", not(feature = "browser-wasm")))]
pub mod validation;

use serde::{Deserialize, Serialize};

/// Equivalent seismic moment magnitude from radiated seismic energy (J),
/// via the Gutenberg-Richter energy relation inverted into Hanks-Kanamori
/// `Mw = (2/3)·(log10 M0 − 9.1)` with `M0 = E_s / 5e-5`.
///
/// The argument is floored to `f64::MIN_POSITIVE` before `log10` so a zero
/// or negative energy (e.g. a landslide with `drop_height_m = 0`, which the
/// IPC layer currently admits) can never produce `-inf`/`NaN` and poison the
/// `InitialDisplacement` snapshot that is serialised to the UI. Callers should
/// still pass non-negative energy; this is a defensive floor, not a license to
/// feed garbage.
pub(crate) fn mw_from_radiated_j(radiated_j: f64) -> f64 {
    let m0 = (radiated_j / 5.0e-5).max(f64::MIN_POSITIVE);
    (2.0 / 3.0) * (m0.log10() - 9.1)
}

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

/// Source-specific geometry retained for the propagation solver's t=0 field.
///
/// Keeping this descriptor beside the scalar summary lets existing consumers
/// continue to use `InitialDisplacement` while the SWE path can reconstruct
/// the physically meaningful annulus, directional slide, or Okada field.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InitialSourceGeometry {
    CavityRing {
        rim_radius_m: f64,
        rim_width_m: f64,
    },
    Landslide {
        /// Clockwise from north. The current source contract has no geographic
        /// slide azimuth, so legacy/custom sources use the documented northward
        /// local-axis convention until that input is introduced.
        axis_azimuth_deg: f64,
        longitudinal_sigma_m: f64,
        transverse_sigma_m: f64,
    },
    Okada {
        fault: okada::OkadaFault,
    },
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
    /// Optional "how often" context for the source (e.g. a Gutenberg–Richter
    /// recurrence estimate for a tectonic earthquake). Order-of-magnitude and
    /// cited; left `None` for sources with no natural recurrence.
    #[serde(default)]
    pub recurrence_note: Option<String>,
    /// Optional curated camera framing populated by `run_preset` for
    /// historical presets. Custom scenarios leave this `None` and the
    /// frontend falls back to its heuristic auto-clamp.
    #[serde(default)]
    pub camera_view: Option<CameraView>,
    /// Optional source geometry used by the SWE initial-condition injector.
    /// Missing values preserve compatibility with older scenario responses and
    /// fall back to the legacy circular Gaussian.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_geometry: Option<InitialSourceGeometry>,
    /// Optional translating atmospheric-pressure source consumed at every SWE
    /// solver step. Older responses omit it and retain displacement-only runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meteotsunami_forcing: Option<meteotsunami::MeteotsunamiSource>,
}
