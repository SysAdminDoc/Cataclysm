//! Bundled offline data sources. Replaces `physics::data` placeholder.
//!
//! The current SWE solver uses a coarse ocean-basin bathymetry approximation
//! so it gets non-uniform depths without requiring a multi-hundred-MB
//! download. GEBCO_2026/TID-backed sampling remains blocked on distribution,
//! storage, and first-run download decisions.

pub mod bathymetry;
pub mod geodesy;
pub mod source_input_contract;
pub mod surface;
