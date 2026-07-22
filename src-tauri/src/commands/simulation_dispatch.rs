use super::*;

pub(crate) fn stream_simulation_cpu(
    grid: &mut SwGrid,
    dt_s: f64,
    snapshot_schedule: &[usize],
    ctx: &StreamSimulationContext<'_>,
) -> Result<(), String> {
    stream_simulation_cpu_from(grid, dt_s, snapshot_schedule, 0, None, ctx)
}

/// Continue the scheduled snapshot stream from an already-committed solver
/// state. `first_take_remaining` is used when a GPU failed partway through the
/// interval at `start_interval`; later intervals use the shared deterministic
/// plan.
pub(crate) fn stream_simulation_cpu_from(
    grid: &mut SwGrid,
    dt_s: f64,
    snapshot_schedule: &[usize],
    start_interval: usize,
    first_take_remaining: Option<usize>,
    ctx: &StreamSimulationContext<'_>,
) -> Result<(), String> {
    let stepper = TimeStepper::new(dt_s).with_boundary(ctx.boundary);
    for (interval, &scheduled_take) in snapshot_schedule.iter().enumerate().skip(start_interval) {
        if ctx.cancel.load(Ordering::Acquire) {
            break;
        }
        let take = if interval == start_interval {
            first_take_remaining.unwrap_or(scheduled_take)
        } else {
            scheduled_take
        };
        if take > 0 {
            match stepper.step_cancellable_checked_forced(
                grid,
                take,
                Some(ctx.cancel),
                ctx.quality_baseline,
                ctx.meteotsunami_forcing,
                &mut |state| ctx.max_field.borrow_mut().observe(state),
            ) {
                Ok(true) => {}
                Ok(false) => break,
                Err(quality) => {
                    publish_run_quality(&quality);
                    let failure = quality
                        .failure
                        .clone()
                        .unwrap_or_else(|| "unknown numerical-integrity violation".to_string());
                    return Err(format!(
                        "simulation rejected at step {}: {failure}",
                        quality.accepted_steps
                    ));
                }
            }
        }
        if ctx
            .on_snapshot
            .send(grid.snapshot_with_gauge_samples(ctx.gauges, ctx.diagnostics))
            .is_err()
        {
            ctx.cancel.store(true, Ordering::Release);
            break;
        }
        if let Some(checkpoint) = ctx.checkpoint {
            checkpoint.borrow_mut().record_gauges(grid);
        }
        if let Some(render) = ctx.render
            && !render.try_send_frame(grid)
        {
            ctx.cancel.store(true, Ordering::Release);
            break;
        }
        if let Some(checkpoint) = ctx.checkpoint {
            let max_field = ctx.max_field.borrow();
            checkpoint.borrow_mut().maybe_write(
                grid,
                &max_field,
                ctx.snapshot_interval_offset
                    .saturating_add(interval)
                    .saturating_add(1),
                false,
                ctx.diagnostics,
            );
        }
    }
    Ok(())
}

#[cfg(feature = "gpu")]
pub(crate) fn stream_simulation_dispatch(
    grid: &mut SwGrid,
    dt_s: f64,
    snapshot_schedule: &[usize],
    ctx: &StreamSimulationContext<'_>,
) -> Result<bool, String> {
    use crate::physics::solver::gpu::GpuTimeStepper;

    if ctx.meteotsunami_forcing.is_some() {
        crate::physics::solver::report_diagnostic(
            ctx.diagnostics,
            "[gpu] moving-pressure forcing remains CPU-authoritative; using CPU to avoid per-step state readback",
        );
        stream_simulation_cpu(grid, dt_s, snapshot_schedule, ctx)?;
        return Ok(false);
    }
    if let Some(gpu) = GpuTimeStepper::new_with_boundary_mode(
        grid,
        dt_s,
        crate::physics::constants::MANNING_N_COASTAL,
        ctx.boundary,
        true,
        ctx.diagnostics,
    ) {
        if !gpu.initialize_resident_max_field(grid, &ctx.max_field.borrow(), ctx.diagnostics) {
            stream_simulation_cpu(grid, dt_s, snapshot_schedule, ctx)?;
            return Ok(false);
        }
        for (interval, &take) in snapshot_schedule.iter().enumerate() {
            if ctx.cancel.load(Ordering::Acquire) {
                break;
            }
            if take > 0
                && (!gpu.dispatch_resident_with_max_field(
                    grid,
                    take,
                    Some(ctx.cancel),
                    ctx.diagnostics,
                ) || !gpu.sync_resident_with_max_field(
                    grid,
                    &mut ctx.max_field.borrow_mut(),
                    ctx.diagnostics,
                ))
            {
                stream_simulation_cpu_from(
                    grid,
                    dt_s,
                    snapshot_schedule,
                    interval,
                    Some(take),
                    ctx,
                )?;
                return Ok(false);
            }
            if take > 0 {
                let quality = ctx.quality_baseline.assess(grid, dt_s);
                if let Some(failure) = quality.failure.clone() {
                    publish_run_quality(&quality);
                    return Err(format!(
                        "GPU simulation rejected at step {}: {failure}",
                        quality.accepted_steps
                    ));
                }
            }
            if ctx
                .on_snapshot
                .send(grid.snapshot_with_gauge_samples(ctx.gauges, ctx.diagnostics))
                .is_err()
            {
                ctx.cancel.store(true, Ordering::Release);
                break;
            }
            if let Some(checkpoint) = ctx.checkpoint {
                checkpoint.borrow_mut().record_gauges(grid);
            }
            if let Some(render) = ctx.render
                && !render.try_send_frame(grid)
            {
                ctx.cancel.store(true, Ordering::Release);
                break;
            }
            if let Some(checkpoint) = ctx.checkpoint {
                let max_field = ctx.max_field.borrow();
                checkpoint.borrow_mut().maybe_write(
                    grid,
                    &max_field,
                    ctx.snapshot_interval_offset
                        .saturating_add(interval)
                        .saturating_add(1),
                    false,
                    ctx.diagnostics,
                );
            }
        }
        return Ok(true);
    }
    stream_simulation_cpu(grid, dt_s, snapshot_schedule, ctx)?;
    Ok(false)
}

#[cfg(not(feature = "gpu"))]
pub(crate) fn stream_simulation_dispatch(
    grid: &mut SwGrid,
    dt_s: f64,
    snapshot_schedule: &[usize],
    ctx: &StreamSimulationContext<'_>,
) -> Result<bool, String> {
    stream_simulation_cpu(grid, dt_s, snapshot_schedule, ctx)?;
    Ok(false)
}

#[cfg(feature = "gpu")]
#[allow(clippy::too_many_arguments)]
pub(crate) fn run_simulation_dispatch(
    grid: &mut SwGrid,
    dt_s: f64,
    t_end_s: f64,
    n_snapshots: usize,
    cancel: &AtomicBool,
    diagnostics: Option<&DiagnosticSink<'_>>,
    gauges: &[GridGaugePoint],
    max_field_threshold_m: f64,
    meteotsunami_forcing: Option<&crate::physics::meteotsunami::MeteotsunamiSource>,
) -> (Vec<GridSnapshot>, bool, MaxFieldAccumulator) {
    use crate::physics::solver::gpu::GpuTimeStepper;

    if meteotsunami_forcing.is_none()
        && let Some(gpu) = GpuTimeStepper::new_with_boundary_mode(
            grid,
            dt_s,
            crate::physics::constants::MANNING_N_COASTAL,
            crate::physics::solver::BoundaryMode::default_sponge(),
            true,
            diagnostics,
        )
    {
        let pristine = grid.clone();
        let mut acc = MaxFieldAccumulator::new(grid.nx * grid.ny, max_field_threshold_m);
        if let Some(snaps) = run_simulation_gpu(
            grid,
            &gpu,
            dt_s,
            t_end_s,
            n_snapshots,
            cancel,
            diagnostics,
            gauges,
            &mut acc,
            meteotsunami_forcing,
        ) {
            return (snaps, true, acc);
        }
        // Discard partial-GPU observations; CPU rerun observes fresh below.
        *grid = pristine;
    }
    let stepper = TimeStepper::new(dt_s);
    let mut acc = MaxFieldAccumulator::new(grid.nx * grid.ny, max_field_threshold_m);
    let snaps = run_simulation_cpu_with_optional_forcing(
        grid,
        &stepper,
        t_end_s,
        n_snapshots,
        cancel,
        diagnostics,
        gauges,
        &mut |g| acc.observe(g),
        meteotsunami_forcing,
    );
    (snaps, false, acc)
}

#[cfg(not(feature = "gpu"))]
#[allow(clippy::too_many_arguments)]
pub(crate) fn run_simulation_dispatch(
    grid: &mut SwGrid,
    dt_s: f64,
    t_end_s: f64,
    n_snapshots: usize,
    cancel: &AtomicBool,
    diagnostics: Option<&DiagnosticSink<'_>>,
    gauges: &[GridGaugePoint],
    max_field_threshold_m: f64,
    meteotsunami_forcing: Option<&crate::physics::meteotsunami::MeteotsunamiSource>,
) -> (Vec<GridSnapshot>, bool, MaxFieldAccumulator) {
    let stepper = TimeStepper::new(dt_s);
    let mut acc = MaxFieldAccumulator::new(grid.nx * grid.ny, max_field_threshold_m);
    let snaps = run_simulation_cpu_with_optional_forcing(
        grid,
        &stepper,
        t_end_s,
        n_snapshots,
        cancel,
        diagnostics,
        gauges,
        &mut |g| acc.observe(g),
        meteotsunami_forcing,
    );
    (snaps, false, acc)
}

/// GPU-side `run_simulation`: emits the same `n_snapshots` evenly-spaced
/// snapshots as the CPU path while keeping solver and quantitative fields
/// resident between display boundaries. Snapshot encoding remains independently paced.
/// Returns `None` if any GPU step fails (map/poll error or non-finite field),
/// signalling the dispatcher to fall back to the CPU path.
#[cfg(feature = "gpu")]
#[allow(clippy::too_many_arguments)]
pub(crate) fn run_simulation_gpu(
    grid: &mut SwGrid,
    gpu: &crate::physics::solver::gpu::GpuTimeStepper,
    dt_s: f64,
    t_end_s: f64,
    n_snapshots: usize,
    cancel: &AtomicBool,
    diagnostics: Option<&DiagnosticSink<'_>>,
    gauges: &[GridGaugePoint],
    max_field: &mut MaxFieldAccumulator,
    meteotsunami_forcing: Option<&crate::physics::meteotsunami::MeteotsunamiSource>,
) -> Option<Vec<GridSnapshot>> {
    let n = n_snapshots.max(2);
    let mut snaps = Vec::with_capacity(n);
    snaps.push(grid.snapshot_with_gauge_samples(gauges, diagnostics));
    max_field.observe(grid);
    if meteotsunami_forcing.is_some()
        || !gpu.initialize_resident_max_field(grid, max_field, diagnostics)
    {
        return None;
    }
    if !t_end_s.is_finite() || t_end_s < 0.0 {
        return Some(snaps);
    }
    for take in snapshot_step_schedule(t_end_s, dt_s, n) {
        if cancel.load(Ordering::Acquire) {
            break;
        }
        if take > 0
            && (!gpu.dispatch_resident_with_max_field(grid, take, Some(cancel), diagnostics)
                || !gpu.sync_resident_with_max_field(grid, max_field, diagnostics))
        {
            return None;
        }
        snaps.push(grid.snapshot_with_gauge_samples(gauges, diagnostics));
    }
    Some(snaps)
}

#[allow(clippy::too_many_arguments)]
fn run_simulation_cpu_with_optional_forcing(
    grid: &mut SwGrid,
    stepper: &TimeStepper,
    t_end_s: f64,
    n_snapshots: usize,
    cancel: &AtomicBool,
    diagnostics: Option<&DiagnosticSink<'_>>,
    gauges: &[GridGaugePoint],
    observe: &mut dyn FnMut(&SwGrid),
    forcing: Option<&crate::physics::meteotsunami::MeteotsunamiSource>,
) -> Vec<GridSnapshot> {
    if forcing.is_none() {
        return run_simulation_with_gauge_samples(
            grid,
            stepper,
            t_end_s,
            n_snapshots,
            Some(cancel),
            diagnostics,
            gauges,
            observe,
        );
    }
    let n = n_snapshots.max(2);
    let mut snapshots = Vec::with_capacity(n);
    snapshots.push(grid.snapshot_with_gauge_samples(gauges, diagnostics));
    observe(grid);
    if !t_end_s.is_finite() || t_end_s < 0.0 {
        return snapshots;
    }
    for take in snapshot_step_schedule(t_end_s, stepper.dt_s, n) {
        for _ in 0..take {
            if cancel.load(Ordering::Acquire) {
                return snapshots;
            }
            if let Some(source) = forcing {
                source.apply_pressure_gradient(grid, grid.t_s + 0.5 * stepper.dt_s, stepper.dt_s);
            }
            stepper.step_one(grid);
            observe(grid);
        }
        snapshots.push(grid.snapshot_with_gauge_samples(gauges, diagnostics));
    }
    snapshots
}
