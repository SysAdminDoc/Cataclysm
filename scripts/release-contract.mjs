export const RELEASE_CARGO_FEATURES = Object.freeze(["gpu"]);

export function cargoFeatureArgs(features = RELEASE_CARGO_FEATURES) {
  return features.length > 0 ? ["--features", features.join(",")] : [];
}

export const RUST_RELEASE_FEATURE_MATRIX = Object.freeze([
  Object.freeze({ label: "default", features: Object.freeze([]) }),
  Object.freeze({ label: "gpu", features: Object.freeze(["gpu"]) }),
  Object.freeze({ label: "validation", features: Object.freeze(["validation"]) }),
  Object.freeze({
    label: "gpu + validation",
    features: Object.freeze(["gpu", "validation"]),
  }),
]);
