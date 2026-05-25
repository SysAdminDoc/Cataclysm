//! Bundled offline data sources. Replaces `physics::data` placeholder.
//!
//! v0.2.0 ships a coarse ocean-basin bathymetry approximation so the SWE
//! solver gets non-uniform depths without requiring a multi-hundred-MB
//! download. v0.3.0 will swap in real GEBCO 2024 NetCDF via a first-run
//! download wizard.

pub mod bathymetry;
