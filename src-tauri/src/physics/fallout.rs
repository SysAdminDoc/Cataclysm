//! Point-sampled early-fallout screening.
//!
//! Spatial H+1 dose rate and mean arrival time follow WSEG Research Memorandum
//! No. 10 as documented by Hanifen (AFIT, 1980, ADA083515). Time decay and
//! cumulative exposure follow Glasstone & Dolan (1977), equations 9.147.1 and
//! 9.150.1. The model is intentionally educational: a single constant wind and
//! fixed shear cannot predict an actual fallout field.

use serde::{Deserialize, Serialize};

use super::direct_hazard::SHELTER_TYPES;

const KM_PER_MILE: f64 = 1.609_344;
const DEFAULT_WIND_SHEAR_MPH_PER_KFT: f64 = 0.2;
const ROENTGEN_ERD_TO_SIEVERT: f64 = 0.01;
const MIN_TIME_H: f64 = 0.5;
const MAX_TIME_H: f64 = 14.0 * 24.0;
const NOMINAL_DECAY_EXPONENT: f64 = 1.2;
const DECAY_EXPONENTS: [f64; 3] = [0.9, NOMINAL_DECAY_EXPONENT, 2.0];
const CURVE_TIMES_H: [f64; 22] = [
    0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0, 18.0, 24.0, 36.0, 48.0, 72.0, 96.0, 120.0,
    168.0, 216.0, 240.0, 288.0, 336.0,
];

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FalloutDoseInput {
    pub yield_kt: f64,
    pub fission_fraction: f64,
    pub downwind_km: f64,
    pub crosswind_km: f64,
    pub wind_speed_kmh: f64,
    pub selected_time_h: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FalloutCitation {
    pub label: &'static str,
    pub url: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FalloutDoseSample {
    pub time_h: f64,
    pub dose_rate_sv_h: f64,
    pub dose_rate_min_sv_h: f64,
    pub dose_rate_max_sv_h: f64,
    pub cumulative_dose_sv: f64,
    pub cumulative_dose_min_sv: f64,
    pub cumulative_dose_max_sv: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FalloutShelterCurve {
    pub shelter_type: &'static str,
    pub exposure_fraction: f64,
    pub selected: FalloutDoseSample,
    pub points: Vec<FalloutDoseSample>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FalloutDoseReport {
    pub model: &'static str,
    pub field_class: &'static str,
    pub downwind_km: f64,
    pub crosswind_km: f64,
    pub wind_speed_kmh: f64,
    pub wind_shear_mph_per_kft: f64,
    pub arrival_time_h: f64,
    pub h_plus_1_dose_rate_sv_h: f64,
    pub selected_time_h: f64,
    pub shelter_curves: Vec<FalloutShelterCurve>,
    pub citations: Vec<FalloutCitation>,
    pub assumptions: Vec<&'static str>,
    pub uncertainty: Vec<&'static str>,
    pub disclaimer: &'static str,
}

#[derive(Debug, Clone, Copy)]
struct Wseg10 {
    yield_mt: f64,
    fission_fraction: f64,
    wind_mph: f64,
    shear_mph_per_kft: f64,
    cloud_center_kft: f64,
    sigma_0_mi: f64,
    sigma_0_sq: f64,
    sigma_h_kft: f64,
    time_constant_h: f64,
    l_0_mi: f64,
    l_0_sq: f64,
    sigma_x_mi: f64,
    sigma_x_sq: f64,
    l_mi: f64,
    l_sq: f64,
    deposition_exponent: f64,
    upwind_alpha: f64,
}

impl Wseg10 {
    fn new(yield_kt: f64, fission_fraction: f64, wind_speed_kmh: f64) -> Option<Self> {
        if !yield_kt.is_finite()
            || !fission_fraction.is_finite()
            || !wind_speed_kmh.is_finite()
            || yield_kt <= 0.0
            || fission_fraction <= 0.0
            || wind_speed_kmh <= 0.0
        {
            return None;
        }
        let yield_mt = yield_kt / 1_000.0;
        let wind_mph = wind_speed_kmh / KM_PER_MILE;
        let ln_yield = yield_mt.ln();
        let d = ln_yield + 2.42;
        let cloud_center_kft = 44.0 + 6.1 * ln_yield - 0.205 * d.abs() * d;
        let sigma_0_mi = (0.7 + ln_yield / 3.0 - 3.25 / (4.0 + (ln_yield + 5.4).powi(2))).exp();
        let sigma_0_sq = sigma_0_mi.powi(2);
        let sigma_h_kft = 0.18 * cloud_center_kft;
        let normalized_height = cloud_center_kft / 60.0;
        let time_constant_h = 1.057_320_3
            * (12.0 * normalized_height - 2.5 * normalized_height.powi(2))
            * (1.0 - 0.5 * (-(cloud_center_kft / 25.0).powi(2)).exp());
        let l_0_mi = wind_mph * time_constant_h;
        let l_0_sq = l_0_mi.powi(2);
        let sigma_x_sq = sigma_0_sq * (l_0_sq + 8.0 * sigma_0_sq) / (l_0_sq + 2.0 * sigma_0_sq);
        let sigma_x_mi = sigma_x_sq.sqrt();
        let l_sq = l_0_sq + 2.0 * sigma_x_sq;
        let l_mi = l_sq.sqrt();
        // Hanifen's F scale factor is 1.0; it is not the fission fraction.
        let deposition_exponent = (l_0_sq + sigma_x_sq) / (l_0_sq + 0.5 * sigma_x_sq);
        let upwind_alpha = 1.0 / (1.0 + (0.001 * cloud_center_kft * wind_mph) / sigma_0_mi);
        let model = Self {
            yield_mt,
            fission_fraction: fission_fraction.clamp(0.0, 1.0),
            wind_mph,
            shear_mph_per_kft: DEFAULT_WIND_SHEAR_MPH_PER_KFT,
            cloud_center_kft,
            sigma_0_mi,
            sigma_0_sq,
            sigma_h_kft,
            time_constant_h,
            l_0_mi,
            l_0_sq,
            sigma_x_mi,
            sigma_x_sq,
            l_mi,
            l_sq,
            deposition_exponent,
            upwind_alpha,
        };
        model.valid().then_some(model)
    }

    fn valid(&self) -> bool {
        [
            self.cloud_center_kft,
            self.sigma_0_mi,
            self.time_constant_h,
            self.l_0_mi,
            self.sigma_x_mi,
            self.l_mi,
            self.deposition_exponent,
            self.upwind_alpha,
        ]
        .into_iter()
        .all(|value| value.is_finite() && value > 0.0)
    }

    fn h_plus_1_sv_h(&self, downwind_km: f64, crosswind_km: f64) -> f64 {
        let x = downwind_km / KM_PER_MILE;
        let y = crosswind_km / KM_PER_MILE;
        let deposition = (-(x.abs() / self.l_mi).powf(self.deposition_exponent)).exp()
            / (self.l_mi * gamma(1.0 + 1.0 / self.deposition_exponent));
        let upwind =
            normal_cdf((self.l_0_mi / self.l_mi) * (x / (self.sigma_x_mi * self.upwind_alpha)));
        let longitudinal = self.yield_mt * 2.0e6 * upwind * deposition * self.fission_fraction;
        let sigma_y = (self.sigma_0_sq
            + (8.0 * (x + 2.0 * self.sigma_x_mi).abs() * self.sigma_0_sq) / self.l_mi
            + (2.0
                * (self.sigma_x_mi
                    * self.time_constant_h
                    * self.sigma_h_kft
                    * self.shear_mph_per_kft)
                    .powi(2))
                / self.l_sq
            + ((x + 2.0 * self.sigma_x_mi)
                * self.l_0_mi
                * self.time_constant_h
                * self.sigma_h_kft
                * self.shear_mph_per_kft)
                .powi(2)
                / self.l_mi.powi(4))
        .sqrt();
        let crosswind_alpha = 1.0
            / (1.0
                + ((0.001 * self.cloud_center_kft * self.wind_mph) / self.sigma_0_mi)
                    * (1.0 - normal_cdf(2.0 * x / self.wind_mph)));
        let lateral = (-0.5 * (y / (crosswind_alpha * sigma_y)).powi(2)).exp()
            / ((2.0 * std::f64::consts::PI).sqrt() * sigma_y);
        (longitudinal * lateral * ROENTGEN_ERD_TO_SIEVERT).max(0.0)
    }

    fn arrival_time_h(&self, downwind_km: f64) -> f64 {
        let x = downwind_km / KM_PER_MILE;
        (0.25
            + (self.l_0_sq * (x + 2.0 * self.sigma_x_mi).powi(2) * self.time_constant_h.powi(2))
                / (self.l_sq * (self.l_0_sq + 0.5 * self.sigma_x_sq))
            + (2.0 * self.sigma_x_sq) / (self.l_0_sq + 0.5 * self.sigma_x_sq))
            .sqrt()
            .max(MIN_TIME_H)
    }
}

pub fn dose_report(input: FalloutDoseInput) -> Option<FalloutDoseReport> {
    let model = Wseg10::new(input.yield_kt, input.fission_fraction, input.wind_speed_kmh)?;
    if !input.downwind_km.is_finite()
        || !input.crosswind_km.is_finite()
        || !input.selected_time_h.is_finite()
    {
        return None;
    }
    let selected_time_h = input.selected_time_h.clamp(MIN_TIME_H, MAX_TIME_H);
    let arrival_time_h = model.arrival_time_h(input.downwind_km);
    let h_plus_1_dose_rate_sv_h = model.h_plus_1_sv_h(input.downwind_km, input.crosswind_km);
    let mut times = CURVE_TIMES_H.to_vec();
    times.extend([
        arrival_time_h.clamp(MIN_TIME_H, MAX_TIME_H),
        selected_time_h,
    ]);
    times.sort_by(f64::total_cmp);
    times.dedup_by(|left, right| (*left - *right).abs() < 1.0e-9);
    let shelter_curves = SHELTER_TYPES
        .iter()
        .map(|shelter| {
            let exposure_fraction = shelter.radiation_exposure_fraction;
            FalloutShelterCurve {
                shelter_type: shelter.name,
                exposure_fraction,
                selected: sample(
                    selected_time_h,
                    arrival_time_h,
                    h_plus_1_dose_rate_sv_h,
                    exposure_fraction,
                ),
                points: times
                    .iter()
                    .map(|time_h| {
                        sample(
                            *time_h,
                            arrival_time_h,
                            h_plus_1_dose_rate_sv_h,
                            exposure_fraction,
                        )
                    })
                    .collect(),
            }
        })
        .collect();

    Some(FalloutDoseReport {
        model: "WSEG-10 H+1 field + Glasstone-Dolan t^-1.2 decay",
        field_class: field_class(h_plus_1_dose_rate_sv_h),
        downwind_km: input.downwind_km,
        crosswind_km: input.crosswind_km.abs(),
        wind_speed_kmh: input.wind_speed_kmh,
        wind_shear_mph_per_kft: DEFAULT_WIND_SHEAR_MPH_PER_KFT,
        arrival_time_h,
        h_plus_1_dose_rate_sv_h,
        selected_time_h,
        shelter_curves,
        citations: vec![
            FalloutCitation {
                label: "Hanifen 1980, Documentation and Analysis of WSEG-10 (ADA083515)",
                url: "https://apps.dtic.mil/sti/citations/ADA083515",
            },
            FalloutCitation {
                label: "Glasstone & Dolan 1977, The Effects of Nuclear Weapons, Chapter IX",
                url: "https://www.osti.gov/biblio/6852629",
            },
            FalloutCitation {
                label: "HHS REMM, fallout decay and Rule of Seven",
                url: "https://remm.hhs.gov/nuclearfallout.htm",
            },
            FalloutCitation {
                label: "LLNL responder planning guidance, dangerous and hot fallout fields",
                url: "https://www.osti.gov/biblio/1093920",
            },
        ],
        assumptions: vec![
            "Single constant wind direction and speed; fixed 0.2 mph/kft vertical wind shear.",
            "Level terrain, no precipitation, no weathering, and no additional fallout deposition after mean arrival.",
            "H+1 WSEG-10 equivalent residual dose converts at 0.01 Sv per roentgen for this historical screening quantity.",
            "Shelter curves reuse the UNI-06 advisor's idealized radiation exposure fractions and assume continuous occupancy.",
        ],
        uncertainty: vec![
            "Displayed bands vary the measured fallout decay exponent from 0.9 to 2.0 around the nominal 1.2 value reported by Glasstone and Dolan.",
            "Real winds, rain, terrain, building leakage, particle-size distribution, and changing deposition can dominate the result; instrument readings take precedence.",
            "WSEG-10 is a historical mean-case damage-assessment model, not a forecast or protective-action tool.",
        ],
        disclaimer: "Educational scenario estimate — not operational guidance. Follow official emergency instructions and measured radiation data.",
    })
}

fn field_class(h_plus_1_dose_rate_sv_h: f64) -> &'static str {
    if h_plus_1_dose_rate_sv_h >= 0.1 {
        "dangerous_fallout_field"
    } else if h_plus_1_dose_rate_sv_h >= 0.0001 {
        "hot_fallout_field"
    } else {
        "below_displayed_field"
    }
}

fn sample(
    time_h: f64,
    arrival_time_h: f64,
    h_plus_1_dose_rate_sv_h: f64,
    exposure_fraction: f64,
) -> FalloutDoseSample {
    let rates = DECAY_EXPONENTS.map(|exponent| {
        dose_rate(time_h, arrival_time_h, h_plus_1_dose_rate_sv_h, exponent) * exposure_fraction
    });
    let cumulative = DECAY_EXPONENTS.map(|exponent| {
        cumulative_dose(time_h, arrival_time_h, h_plus_1_dose_rate_sv_h, exponent)
            * exposure_fraction
    });
    FalloutDoseSample {
        time_h,
        dose_rate_sv_h: rates[1],
        dose_rate_min_sv_h: rates.into_iter().fold(f64::INFINITY, f64::min),
        dose_rate_max_sv_h: rates.into_iter().fold(0.0, f64::max),
        cumulative_dose_sv: cumulative[1],
        cumulative_dose_min_sv: cumulative.into_iter().fold(f64::INFINITY, f64::min),
        cumulative_dose_max_sv: cumulative.into_iter().fold(0.0, f64::max),
    }
}

fn dose_rate(time_h: f64, arrival_time_h: f64, h_plus_1_sv_h: f64, exponent: f64) -> f64 {
    if time_h < arrival_time_h {
        0.0
    } else {
        h_plus_1_sv_h * time_h.max(MIN_TIME_H).powf(-exponent)
    }
}

fn cumulative_dose(time_h: f64, arrival_time_h: f64, h_plus_1_sv_h: f64, exponent: f64) -> f64 {
    if time_h <= arrival_time_h {
        return 0.0;
    }
    let start = arrival_time_h.max(MIN_TIME_H);
    if (exponent - 1.0).abs() < 1.0e-12 {
        h_plus_1_sv_h * (time_h / start).ln()
    } else {
        h_plus_1_sv_h * (time_h.powf(1.0 - exponent) - start.powf(1.0 - exponent))
            / (1.0 - exponent)
    }
}

// Abramowitz-Stegun 7.1.26. More than sufficient for a screening field whose
// source model carries orders-of-magnitude meteorological uncertainty.
fn normal_cdf(value: f64) -> f64 {
    let sign = if value < 0.0 { -1.0 } else { 1.0 };
    let x = value.abs() / std::f64::consts::SQRT_2;
    let t = 1.0 / (1.0 + 0.327_591_1 * x);
    let erf = 1.0
        - (((((1.061_405_429 * t - 1.453_152_027) * t) + 1.421_413_741) * t - 0.284_496_736) * t
            + 0.254_829_592)
            * t
            * (-x * x).exp();
    0.5 * (1.0 + sign * erf)
}

// Lanczos approximation, evaluated here only around z=1.5..2.0.
fn gamma(value: f64) -> f64 {
    const COEFFICIENTS: [f64; 8] = [
        676.520_368_121_885_1,
        -1_259.139_216_722_402_8,
        771.323_428_777_653_1,
        -176.615_029_162_140_6,
        12.507_343_278_686_905,
        -0.138_571_095_265_720_12,
        9.984_369_578_019_572e-6,
        1.505_632_735_149_311_6e-7,
    ];
    if value < 0.5 {
        return std::f64::consts::PI / ((std::f64::consts::PI * value).sin() * gamma(1.0 - value));
    }
    let z = value - 1.0;
    let mut x = 0.999_999_999_999_809_9;
    for (index, coefficient) in COEFFICIENTS.iter().enumerate() {
        x += coefficient / (z + index as f64 + 1.0);
    }
    let t = z + 7.5;
    (2.0 * std::f64::consts::PI).sqrt() * t.powf(z + 0.5) * (-t).exp() * x
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wseg10_reference_point_matches_independent_fixture() {
        let model = Wseg10::new(100.0, 0.5, 40.0).expect("valid model");
        let rate = model.h_plus_1_sv_h(10.0, 0.0);
        let arrival = model.arrival_time_h(10.0);
        assert!(
            (rate - 3.179_007_356_911_457_6).abs() < 2.0e-6,
            "rate={rate}"
        );
        assert!((arrival - 0.587_947_370_408_378_1).abs() < 1.0e-10);
    }

    #[test]
    fn field_falls_off_crosswind_and_respects_fission_fraction() {
        let full = Wseg10::new(100.0, 1.0, 40.0).unwrap();
        let half = Wseg10::new(100.0, 0.5, 40.0).unwrap();
        let hotline = half.h_plus_1_sv_h(20.0, 0.0);
        assert!(hotline > half.h_plus_1_sv_h(20.0, 20.0));
        assert!((full.h_plus_1_sv_h(20.0, 0.0) / hotline - 2.0).abs() < 1.0e-12);
    }

    #[test]
    fn nominal_decay_and_integral_follow_published_equations() {
        let rate_h1 = 1.0;
        let at_seven = dose_rate(7.0, 0.5, rate_h1, 1.2);
        assert!((at_seven - 7.0_f64.powf(-1.2)).abs() < 1.0e-12);
        let integrated = cumulative_dose(24.0, 1.0, rate_h1, 1.2);
        let expected = 5.0 * (1.0 - 24.0_f64.powf(-0.2));
        assert!((integrated - expected).abs() < 1.0e-12);
    }

    #[test]
    fn report_reuses_shelter_factors_and_keeps_uncertainty_bounded() {
        let report = dose_report(FalloutDoseInput {
            yield_kt: 100.0,
            fission_fraction: 0.5,
            downwind_km: 10.0,
            crosswind_km: 0.0,
            wind_speed_kmh: 40.0,
            selected_time_h: 24.0,
        })
        .unwrap();
        assert_eq!(report.shelter_curves.len(), SHELTER_TYPES.len());
        let open = &report.shelter_curves[0].selected;
        let purpose_built = report.shelter_curves.last().unwrap();
        assert!(purpose_built.selected.cumulative_dose_sv < open.cumulative_dose_sv);
        assert!(open.dose_rate_min_sv_h <= open.dose_rate_sv_h);
        assert!(open.dose_rate_sv_h <= open.dose_rate_max_sv_h);
        assert!(
            report
                .citations
                .iter()
                .all(|citation| citation.url.starts_with("https://"))
        );
    }

    #[test]
    fn invalid_or_zero_source_does_not_emit_a_report() {
        assert!(Wseg10::new(0.0, 0.5, 40.0).is_none());
        assert!(Wseg10::new(100.0, 0.0, 40.0).is_none());
        assert!(Wseg10::new(100.0, 0.5, f64::NAN).is_none());
    }
}
