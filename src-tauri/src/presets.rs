//! Registry of historical and hypothetical tsunami events with peer-reviewed
//! source parameters. Every entry carries its citation in the `reference` field.

use serde::Serialize;

use crate::physics::{
    asteroid::AsteroidImpact,
    earthquake::EarthquakeSource,
    landslide::LandslideSource,
    nuclear::NuclearBurst,
    CameraView, GeoPoint, InitialDisplacement,
};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "source")]
pub enum PresetSource {
    Asteroid(AsteroidImpact),
    Earthquake(EarthquakeSource),
    Landslide(LandslideSource),
    Nuclear(NuclearBurst),
}

impl PresetSource {
    pub fn initial_displacement(&self) -> InitialDisplacement {
        match self {
            Self::Asteroid(a) => a.initial_displacement(),
            Self::Earthquake(e) => e.initial_displacement(),
            Self::Landslide(l) => l.initial_displacement(),
            Self::Nuclear(n) => n.initial_displacement(),
        }
    }

    /// Decay exponent for the cheap far-field sampler.
    /// Impact tsunamis: 5/6 (Ward-Asphaug). Everything else: 1/2 (point source).
    pub fn far_field_decay_alpha(&self) -> f64 {
        match self {
            Self::Asteroid(_) => 5.0 / 6.0,
            _ => 0.5,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    pub date: &'static str,
    pub blurb: &'static str,
    pub reference: &'static str,
    pub source: PresetSource,
    /// Optional URL for the cited paper. Populated for entries where a
    /// canonical DOI / publisher page is publicly accessible.
    #[serde(default)]
    pub reference_url: Option<&'static str>,
    /// `true` for hypothetical, contested, or propaganda-grade scenarios so
    /// the UI can flag them with a ⚠ icon and a tooltip.
    #[serde(default)]
    pub is_speculative: bool,
    /// Optional one-line caveat shown alongside the ⚠ icon when `is_speculative`.
    #[serde(default)]
    pub controversy_note: Option<&'static str>,
    /// Optional curated Cesium camera framing for this preset; overrides
    /// the frontend's heuristic auto-clamp on `flyTo`.
    #[serde(default)]
    pub camera_view: Option<CameraView>,
}

/// All built-in presets. IDs are stable; the frontend keys off them.
pub fn all_presets() -> Vec<Preset> {
    vec![
        Preset {
            id: "chicxulub",
            name: "Chicxulub Impact",
            date: "66 Ma",
            blurb: "14-km asteroid into a shallow Yucatan sea. End-Cretaceous extinction event. Initial 4.5-km ejecta-driven wall, 1.5-km ring wave at 220 km, 10+ m on most coasts.",
            reference: "Range et al. 2022, AGU Advances, doi:10.1029/2021AV000627",
            reference_url: Some("https://doi.org/10.1029/2021AV000627"),
            is_speculative: false,
            controversy_note: None,
            // Continent-scale view — Chicxulub's ring wave reaches the Atlantic seaboard.
            camera_view: Some(CameraView { heading_deg: 0.0, pitch_deg: -55.0, range_m: 5_000_000.0 }),
            source: PresetSource::Asteroid(AsteroidImpact {
                diameter_m: 14_000.0,
                density_kg_m3: 3000.0,
                velocity_m_s: 20_000.0,
                angle_deg: 60.0,
                water_depth_m: 1_500.0,
                location: GeoPoint { lat_deg: 21.4, lon_deg: -89.5, depth_m: 1_500.0 },
            }),
        },
        Preset {
            id: "eltanin",
            name: "Eltanin Impact",
            date: "2.51 Ma",
            blurb: "~1 km asteroid into the deep South Pacific. Only known Cenozoic deep-ocean impact. Generated a globally significant tsunami inferred from disturbed deep-sea sediments.",
            reference: "Gersonde et al. 1997, Nature 390:357; Ward & Asphaug 2002 Deep-Sea Res II",
            reference_url: Some("https://www.nature.com/articles/37044"),
            is_speculative: false,
            controversy_note: None,
            camera_view: Some(CameraView { heading_deg: 0.0, pitch_deg: -60.0, range_m: 6_000_000.0 }),
            source: PresetSource::Asteroid(AsteroidImpact {
                diameter_m: 1_000.0,
                density_kg_m3: 3000.0,
                velocity_m_s: 20_000.0,
                angle_deg: 45.0,
                water_depth_m: 4_500.0,
                location: GeoPoint { lat_deg: -57.7, lon_deg: -90.8, depth_m: 4_500.0 },
            }),
        },
        Preset {
            id: "tohoku_2011",
            name: "Tōhoku Earthquake & Tsunami",
            date: "2011-03-11",
            blurb: "M_w 9.1 megathrust off Sanriku coast. 40 m maximum runup at Miyako, 19 k+ killed, Fukushima Daiichi.",
            reference: "Mori et al. 2011, GRL; Fujii & Satake 2013",
            reference_url: Some("https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2011GL049210"),
            is_speculative: false,
            controversy_note: None,
            // Frames Honshu + the Japan Trench rupture zone.
            camera_view: Some(CameraView { heading_deg: 280.0, pitch_deg: -45.0, range_m: 2_000_000.0 }),
            source: PresetSource::Earthquake(EarthquakeSource {
                mw: 9.1,
                depth_m: 30_000.0,
                strike_deg: 195.0,
                dip_deg: 12.0,
                rake_deg: 85.0,
                slip_m: 30.0,
                fault_length_m: 500_000.0,
                fault_width_m: 200_000.0,
                water_depth_m: 1_500.0,
                location: GeoPoint { lat_deg: 38.297, lon_deg: 142.372, depth_m: 1_500.0 },
            }),
        },
        Preset {
            id: "indian_ocean_2004",
            name: "Indian Ocean Earthquake & Tsunami",
            date: "2004-12-26",
            blurb: "M_w 9.2 Sumatra-Andaman megathrust. 30 m runup, 230 k+ killed across 14 countries.",
            reference: "Synolakis et al. 2005, PNAS; Lay et al. 2005 Science",
            reference_url: Some("https://www.science.org/doi/10.1126/science.1112250"),
            is_speculative: false,
            controversy_note: None,
            // Frames Sumatra-Andaman + the rupture zone running NNW.
            camera_view: Some(CameraView { heading_deg: 330.0, pitch_deg: -40.0, range_m: 3_000_000.0 }),
            source: PresetSource::Earthquake(EarthquakeSource {
                mw: 9.2,
                depth_m: 30_000.0,
                strike_deg: 329.0,
                dip_deg: 8.0,
                rake_deg: 110.0,
                slip_m: 20.0,
                fault_length_m: 1_300_000.0,
                fault_width_m: 200_000.0,
                water_depth_m: 3_500.0,
                location: GeoPoint { lat_deg: 3.316, lon_deg: 95.854, depth_m: 3_500.0 },
            }),
        },
        Preset {
            id: "lituya_bay_1958",
            name: "Lituya Bay Megatsunami",
            date: "1958-07-09",
            blurb: "30 M m³ rockslide into Gilbert Inlet triggered by M 7.8 Fairweather quake. World-record 524 m runup on the opposite shore — confined fjord geometry.",
            reference: "Fritz, Hager & Minor 2001, Sci. Tsunami Hazards 19:3",
            reference_url: Some("http://library.lanl.gov/tsunami/ts193.pdf"),
            is_speculative: false,
            controversy_note: None,
            // Tight fjord-scale view — Gilbert Inlet is only ~1.3 km wide.
            camera_view: Some(CameraView { heading_deg: 60.0, pitch_deg: -30.0, range_m: 50_000.0 }),
            source: PresetSource::Landslide(crate::physics::landslide::lituya_bay_1958()),
        },
        Preset {
            id: "krakatoa_1883",
            name: "Krakatoa Caldera Collapse",
            date: "1883-08-27",
            blurb: "VEI 6 eruption + caldera collapse in the Sunda Strait. 36-42 m peak tsunami waves struck Java/Sumatra coasts, ~36,000 killed. Triggered by pyroclastic flows entering the sea + caldera subsidence; mechanism still debated (Maeno & Imamura 2011 vs. Self & Rampino 1981).",
            reference: "Choi et al. 2003, Sci. Tsunami Hazards 21:71; Maeno & Imamura 2011, JGR",
            reference_url: Some("http://www.tsunamisociety.org/213choi.pdf"),
            is_speculative: false,
            controversy_note: None,
            // Sunda Strait + Java/Sumatra coasts.
            camera_view: Some(CameraView { heading_deg: 0.0, pitch_deg: -45.0, range_m: 1_500_000.0 }),
            source: PresetSource::Landslide(LandslideSource {
                kind: crate::physics::landslide::LandslideKind::Submarine,
                volume_m3: 1.2e10,
                density_kg_m3: 2500.0,
                drop_height_m: 400.0,
                slope_deg: 30.0,
                water_depth_m: 250.0,
                water_body_width_m: 8_000.0,
                location: GeoPoint { lat_deg: -6.102, lon_deg: 105.423, depth_m: 250.0 },
            }),
        },
        Preset {
            id: "storegga",
            name: "Storegga Submarine Slide",
            date: "~8150 BP",
            blurb: "3000 km³ submarine landslide off Norway. 20+ m tsunami struck Scotland, Faroes, and Doggerland. Mesolithic human displacement.",
            reference: "Bondevik et al. 2005, Marine Geology 215:1; Kim et al. 2019 JGR Oceans",
            reference_url: Some("https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2018JC014893"),
            is_speculative: false,
            controversy_note: None,
            // Frames the Norwegian Sea + Scotland + Faroes runup zones.
            camera_view: Some(CameraView { heading_deg: 220.0, pitch_deg: -50.0, range_m: 3_000_000.0 }),
            source: PresetSource::Landslide(LandslideSource {
                kind: crate::physics::landslide::LandslideKind::Submarine,
                volume_m3: 3.0e12,
                density_kg_m3: 1800.0,
                drop_height_m: 800.0,
                slope_deg: 3.0,
                water_depth_m: 1_000.0,
                water_body_width_m: 300_000.0,
                location: GeoPoint { lat_deg: 64.5, lon_deg: 3.5, depth_m: 1_000.0 },
            }),
        },
        Preset {
            id: "hunga_tonga_2022",
            name: "Hunga Tonga Volcanic Tsunami",
            date: "2022-01-15",
            blurb: "VEI 5–6 submarine caldera collapse. 15 m local tsunami plus globally observed atmospheric Lamb wave – ocean coupling — novel for modern instrumented era. Note: this preset models only the submarine collapse, not the Lamb-wave coupling (planned for v0.3.0).",
            reference: "Carvajal et al. 2022, Science 377:91; Matoza et al. 2022 Science 377:95",
            reference_url: Some("https://www.science.org/doi/10.1126/science.abo4364"),
            is_speculative: false,
            controversy_note: Some("Atmospheric Lamb-wave coupling (Carvajal 2022, Matoza 2022) is modelled as an optional IC injection — toggle 'Include atmospheric Lamb-wave forcing' in the Live SWE Solver panel."),
            // Tonga + Pacific basin.
            camera_view: Some(CameraView { heading_deg: 0.0, pitch_deg: -50.0, range_m: 2_500_000.0 }),
            source: PresetSource::Landslide(LandslideSource {
                kind: crate::physics::landslide::LandslideKind::Submarine,
                volume_m3: 1.9e10,
                density_kg_m3: 2200.0,
                drop_height_m: 700.0,
                slope_deg: 35.0,
                water_depth_m: 1_500.0,
                water_body_width_m: 5_000.0,
                location: GeoPoint { lat_deg: -20.55, lon_deg: -175.39, depth_m: 1_500.0 },
            }),
        },
        Preset {
            id: "cumbre_vieja_scenario",
            name: "Cumbre Vieja Flank Collapse (Hypothetical)",
            date: "—",
            blurb: "Ward & Day 2001 hypothesized a 500 km³ flank collapse of La Palma could generate 5–25 m waves on the US East Coast. Subsequent work (Løvholt 2008, Pararas-Carayannis 2002) finds the estimate exaggerated by 5–10×. Included so users can see both extremes. The 2021 eruption did NOT trigger the catastrophic collapse.",
            reference: "Ward & Day 2001, GRL 28:3397; Løvholt et al. 2008 JGR (rebuttal)",
            reference_url: Some("https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2001GL013110"),
            is_speculative: true,
            controversy_note: Some("Disputed hypothesis: Ward-Day 2001 worst case vs. Løvholt 2008 dispersive rebuttal (3–8 m Atlantic, not 25 m)."),
            // Atlantic basin: La Palma + US East Coast in one view.
            camera_view: Some(CameraView { heading_deg: 270.0, pitch_deg: -55.0, range_m: 5_500_000.0 }),
            source: PresetSource::Landslide(LandslideSource {
                kind: crate::physics::landslide::LandslideKind::Submarine,
                volume_m3: 5.0e11,
                density_kg_m3: 2700.0,
                drop_height_m: 4_000.0,
                slope_deg: 20.0,
                water_depth_m: 2_500.0,
                water_body_width_m: 30_000.0,
                location: GeoPoint { lat_deg: 28.57, lon_deg: -17.87, depth_m: 0.0 },
            }),
        },
        Preset {
            id: "poseidon_realistic",
            name: "Poseidon Torpedo (Realistic Yield)",
            date: "—",
            blurb: "Conservative 2-Mt warhead detonated at optimum depth — Western technical estimate (Hambling 2022). Produces a few-meter wave at 100 km, not the Russian propaganda 500-m mega-tsunami.",
            reference: "Hambling 2022, Forbes; DNA-TR-96-77 (1996); Spriggs LLNL via Smithsonian 2018",
            reference_url: Some("https://www.forbes.com/sites/davidhambling/2022/05/04/russias-poseidon-2km-tsunami-apocalypse-weapon-just-propaganda/"),
            is_speculative: true,
            controversy_note: Some("Hypothetical weapon system; yield estimate, not historical event."),
            // Mid-Atlantic local view.
            camera_view: Some(CameraView { heading_deg: 0.0, pitch_deg: -40.0, range_m: 1_000_000.0 }),
            source: PresetSource::Nuclear(crate::physics::nuclear::poseidon_realistic(
                GeoPoint { lat_deg: 50.0, lon_deg: -10.0, depth_m: 4_000.0 },
                4_000.0,
            )),
        },
        Preset {
            id: "poseidon_propaganda",
            name: "Poseidon Torpedo (Russian Claim — Demonstrably Exaggerated)",
            date: "—",
            blurb: "100-Mt warhead at optimum depth — Russian state TV (Kiselyov, May 2022) claim. Even at this yield the physics gives a wave that decays to a few tens of meters within 100 km, not the propaganda 500-m wall. Show the contrast.",
            reference: "Russian state TV 2022; Hambling 2022 (critique); Glasstone & Dolan 1977",
            reference_url: Some("https://www.forbes.com/sites/davidhambling/2022/05/04/russias-poseidon-2km-tsunami-apocalypse-weapon-just-propaganda/"),
            is_speculative: true,
            controversy_note: Some("Propaganda-grade yield. Western technical analysts call the 100-Mt claim 'simply insane' (Hambling 2022)."),
            // Same Mid-Atlantic local view as the realistic variant, so
            // toggling between the two doesn't visually relocate.
            camera_view: Some(CameraView { heading_deg: 0.0, pitch_deg: -40.0, range_m: 1_000_000.0 }),
            source: PresetSource::Nuclear(crate::physics::nuclear::poseidon_propaganda(
                GeoPoint { lat_deg: 50.0, lon_deg: -10.0, depth_m: 4_000.0 },
                4_000.0,
            )),
        },
    ]
}

pub fn find_preset(id: &str) -> Option<Preset> {
    all_presets().into_iter().find(|p| p.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn preset_ids_are_unique() {
        let presets = all_presets();
        let mut seen: HashSet<&'static str> = HashSet::new();
        for p in &presets {
            assert!(seen.insert(p.id), "duplicate preset id: {}", p.id);
        }
        assert_eq!(seen.len(), presets.len());
    }

    #[test]
    fn every_preset_has_nonempty_metadata() {
        for p in all_presets() {
            assert!(!p.id.is_empty(), "preset id must be non-empty");
            assert!(!p.name.is_empty(), "preset name must be non-empty: {}", p.id);
            assert!(!p.reference.is_empty(), "preset reference must be non-empty: {}", p.id);
            assert!(!p.blurb.is_empty(), "preset blurb must be non-empty: {}", p.id);
            if p.is_speculative {
                assert!(
                    p.controversy_note.is_some(),
                    "speculative preset {} must have a controversy_note",
                    p.id
                );
            }
        }
    }

    #[test]
    fn every_preset_initial_displacement_is_finite() {
        for p in all_presets() {
            let d = p.source.initial_displacement();
            assert!(d.peak_amplitude_m.is_finite(), "preset {} produced non-finite amplitude", p.id);
            assert!(d.cavity_radius_m.is_finite(), "preset {} produced non-finite cavity radius", p.id);
            assert!(d.source_energy_j.is_finite(), "preset {} produced non-finite energy", p.id);
            assert!(d.peak_amplitude_m >= 0.0, "preset {} produced negative amplitude", p.id);
            assert!(d.cavity_radius_m > 0.0, "preset {} produced non-positive cavity radius", p.id);
        }
    }
}
