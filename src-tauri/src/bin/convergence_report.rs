#[cfg(feature = "validation")]
fn main() {
    use tsunami_simulator_lib::physics::validation::{
        build_convergence_report, validate_convergence_report,
    };

    let report = build_convergence_report().unwrap_or_else(|error| {
        eprintln!("convergence report failed: {error}");
        std::process::exit(1);
    });
    if std::env::args().any(|argument| argument == "--check") {
        validate_convergence_report(
            &report,
            include_str!("../../../src/data/solver-convergence-contract.json"),
        )
        .unwrap_or_else(|error| {
            eprintln!("convergence approval failed: {error}");
            std::process::exit(1);
        });
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("convergence report must serialize")
    );
}

#[cfg(not(feature = "validation"))]
fn main() {
    eprintln!("convergence_report requires --features validation");
    std::process::exit(2);
}
