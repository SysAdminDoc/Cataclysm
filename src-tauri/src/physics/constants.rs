//! Physical constants. All SI unless explicitly noted.

/// Standard gravity at Earth's surface, m/s².
pub const G_EARTH: f64 = 9.80665;

/// Earth's mean radius, m (WGS84 spheroidal mean).
pub const R_EARTH_M: f64 = 6_371_008.8;

/// Reference density of seawater at 15 °C, salinity 35 PSU, kg/m³.
pub const RHO_SEAWATER: f64 = 1_025.0;

/// Reference density of freshwater at 4 °C, kg/m³.
pub const RHO_FRESHWATER: f64 = 1_000.0;

/// Density of typical continental crust rock (granitic), kg/m³.
pub const RHO_ROCK_CRUST: f64 = 2_700.0;

/// Density of typical chondritic asteroid, kg/m³ (Hilton 2002).
pub const RHO_ASTEROID_STONY: f64 = 3_000.0;

/// Density of typical iron asteroid (M-type), kg/m³.
pub const RHO_ASTEROID_IRON: f64 = 7_800.0;

/// Density of typical cometary nucleus, kg/m³ (Davidsson et al. 2016 for 67P).
pub const RHO_COMET: f64 = 535.0;

/// Energy released by 1 ton of TNT, in joules (IUPAC convention).
pub const J_PER_TON_TNT: f64 = 4.184e9;

/// Energy released by 1 kiloton of TNT, in joules.
pub const J_PER_KT_TNT: f64 = 4.184e12;

/// Energy released by 1 megaton of TNT, in joules.
pub const J_PER_MT_TNT: f64 = 4.184e15;

/// Schmidt–Holsapple cavity-scaling exponent for water targets (Ward & Asphaug 2000).
pub const SCHMIDT_HOLSAPPLE_BETA: f64 = 0.22;

/// Schmidt–Holsapple cavity-scaling prefactor for water targets (Ward & Asphaug 2000).
pub const SCHMIDT_HOLSAPPLE_CT: f64 = 1.88;

/// Fraction of a submerged nuclear explosion's energy that ends up in propagating
/// surface waves (Defense Nuclear Agency 1996; cited by Spriggs LLNL).
pub const NUCLEAR_WAVE_EFFICIENCY: f64 = 0.05;

/// Far-field amplitude attenuation exponent for impact tsunamis in a uniform
/// deep ocean (Ward & Asphaug 2000): A(r) ∝ (R_c / r)^α, with α = 5/6.
pub const IMPACT_FAR_FIELD_EXPONENT: f64 = 5.0 / 6.0;

/// Manning's roughness coefficient `n` for nearshore bathymetry, dimensionless
/// (Bricker et al. 2015 — typical for sandy/rocky coasts in tsunami modeling).
pub const MANNING_N_COASTAL: f64 = 0.025;
