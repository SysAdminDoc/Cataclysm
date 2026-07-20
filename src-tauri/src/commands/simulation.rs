use super::*;

#[path = "simulation_dispatch.rs"]
mod dispatch;
#[path = "simulation_model.rs"]
mod model;
#[path = "simulation_run.rs"]
mod run;
#[path = "simulation_stream.rs"]
mod stream;

pub(crate) use dispatch::*;
pub(crate) use model::*;
#[cfg(test)]
pub(crate) use run::compute_quick_eta;
pub(crate) use stream::*;

pub use model::{SimulateGridRequest, SimulateGridResponse, SimulationRunLifecycle};
pub use run::{GridGaugeHistoryFrame, SimulateGridStreamMeta, simulate_grid, quick_eta_preview};
pub use stream::simulate_grid_streaming;
