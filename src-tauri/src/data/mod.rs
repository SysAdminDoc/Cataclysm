//! Bundled offline data sources. Replaces `physics::data` placeholder.
//!
//! The current SWE solver uses a coarse ocean-basin bathymetry approximation
//! so it gets non-uniform depths without requiring a multi-hundred-MB
//! download. Real GEBCO/SRTM15+ sampling remains blocked on distribution and
//! storage decisions.

pub mod bathymetry;
