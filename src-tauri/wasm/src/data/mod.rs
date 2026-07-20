//! Shared data contracts needed by the physics models in the browser build.
//!
//! `physics::direct_hazard` validates its inputs against the source-input
//! contract via `crate::data::source_input_contract`. We re-expose the exact
//! same desktop source file here (no fork) so the Rust asteroid/nuclear models
//! link into the browser-wasm target unchanged.

#[path = "../../../src/data/source_input_contract.rs"]
pub mod source_input_contract;
