use std::{env, process};

fn main() {
    process::exit(tsunami_simulator_lib::commands::run_headless_cli(
        env::args_os().skip(1),
    ));
}
