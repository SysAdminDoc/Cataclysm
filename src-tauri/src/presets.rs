//! Registry of historical and hypothetical tsunami events with peer-reviewed
//! source parameters. Every entry carries its citation in the `reference` field.

use serde::Serialize;

use crate::physics::{
    asteroid::AsteroidImpact,
    earthquake::EarthquakeSource,
    landslide::LandslideSource,
    meteotsunami::MeteotsunamiSource,
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
    Meteotsunami(MeteotsunamiSource),
}

impl PresetSource {
    pub fn initial_displacement(&self) -> InitialDisplacement {
        match self {
            Self::Asteroid(a) => a.initial_displacement(),
            Self::Earthquake(e) => e.initial_displacement(),
            Self::Landslide(l) => l.initial_displacement(),
            Self::Nuclear(n) => n.initial_displacement(),
            Self::Meteotsunami(m) => m.initial_displacement(),
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
            id: "lake_superior_meteotsunami_2025",
            name: "Lake Superior Meteotsunami",
            date: "2025-06-21",
            blurb: "A west-to-east moving pressure disturbance generates a meteotsunami across Lake Superior. NOAA GLERL measured a 19.3-inch meteotsunami rise at Point Iroquois; the later 45.4-inch rebound combined wind-driven surge and seiche processes that this pressure-only source does not model.",
            reference: "NOAA GLERL, June 21 2025 Storm Causes Significant Meteotsunami and Seiche on Lake Superior (2025-07-18)",
            reference_url: Some("https://www.glerl.noaa.gov/blog/2025/07/18/june-21-2025-storm-causes-significant-meteotsunami-and-seiche-on-lake-superior/"),
            is_speculative: true,
            controversy_note: Some("Educational pressure-only reconstruction: the 300 Pa Gaussian and 39 m/s translation are representative parameters inferred from the reported west-to-east four-hour crossing, not a calibrated NOAA hindcast."),
            camera_view: Some(CameraView { heading_deg: 90.0, pitch_deg: -60.0, range_m: 900_000.0 }),
            source: PresetSource::Meteotsunami(MeteotsunamiSource {
                peak_pressure_pa: 300.0,
                speed_m_s: 39.0,
                heading_deg: 90.0,
                along_track_sigma_m: 40_000.0,
                cross_track_sigma_m: 120_000.0,
                track_length_m: 560_000.0,
                water_depth_m: 155.0,
                location: GeoPoint { lat_deg: 47.1, lon_deg: -92.1, depth_m: 155.0 },
            }),
        },
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
            camera_view: Some(CameraView { heading_deg: 345.0, pitch_deg: -72.0, range_m: 4_800_000.0 }),
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
            blurb: "VEI 5–6 submarine caldera collapse. 15 m local tsunami plus globally observed atmospheric Lamb wave – ocean coupling — novel for modern instrumented era. Note: this preset models only the submarine collapse; atmospheric Lamb-wave coupling is available as an optional IC injection in the Live SWE Solver panel.",
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
            id: "kamchatka_2025",
            name: "Kamchatka Earthquake & Tsunami",
            date: "2025-07-29",
            blurb: "M_w 8.8 megathrust off SE Kamchatka — sixth-largest instrumentally recorded earthquake and the most DART-instrumented tsunami in history (40+ buoys). Pacific-wide propagation; 3–5 m local waves, ~1.3 m water-column at nearby DART stations.",
            // USGS event us6000qw60: epicenter 52.4948°N 160.2395°E, hypocentre
            // depth 35 km, Mww 8.8. Finite-fault model: strike 217° (all three
            // segments), middle-segment dip 17°, peak slip 39.3 m over a
            // 620 km model extent; literature width estimate 140–200 km.
            // Single-plane approximation follows the Tōhoku preset convention
            // (uniform slip between the finite-fault peak and the
            // M0-consistent mean; thrust rake). Fault-top depth 20 km places
            // the plane's centroid near the 35 km hypocentre at dip 17°.
            // Water depth at the epicentral forearc is approximate (~4 km).
            reference: "USGS event us6000qw60 (W-phase + finite fault); NOAA NCTR kamchatka20250729",
            reference_url: Some("https://earthquake.usgs.gov/earthquakes/eventpage/us6000qw60"),
            is_speculative: false,
            controversy_note: None,
            // Kuril-Kamchatka trench + NW Pacific framing.
            camera_view: Some(CameraView { heading_deg: 30.0, pitch_deg: -45.0, range_m: 2_500_000.0 }),
            source: PresetSource::Earthquake(EarthquakeSource {
                mw: 8.8,
                depth_m: 20_000.0,
                strike_deg: 217.0,
                dip_deg: 17.0,
                rake_deg: 90.0,
                slip_m: 20.0,
                fault_length_m: 620_000.0,
                fault_width_m: 150_000.0,
                water_depth_m: 4_000.0,
                location: GeoPoint { lat_deg: 52.4948, lon_deg: 160.2395, depth_m: 4_000.0 },
            }),
        },
        Preset {
            id: "sanriku_2026",
            name: "Sanriku (Miyako) Earthquake & Tsunami",
            date: "2026-04-20",
            blurb: "M_w 7.4 (M_JMA 7.7) thrust off the Sanriku coast. Modest tsunami detected at a coastal tide gauge 17 minutes after rupture — a modern example of the Pacific warning system working as designed.",
            // USGS event us6000sri7: epicenter 39.971°N 143.0592°E, depth
            // 25 km, Mww 7.4 (JMA magnitude 7.7). Finite-fault plane:
            // strike 193°, dip 16° (matches Mww nodal plane 2 at
            // 192.9°/15.9°/rake 93.9°); maximum slip 4.73 m over a
            // ~70 × 65 km rupture area. Uniform slip set to the finite-fault
            // maximum (single-plane convention). Forearc water depth ~1.5 km
            // as for the Tōhoku preset.
            reference: "USGS event us6000sri7 (W-phase + finite fault); NOAA NCTR miyako20260420",
            reference_url: Some("https://earthquake.usgs.gov/earthquakes/eventpage/us6000sri7"),
            is_speculative: false,
            controversy_note: Some("Recent event — peer-reviewed source models are still in review; parameters follow the USGS finite-fault product."),
            camera_view: Some(CameraView { heading_deg: 280.0, pitch_deg: -45.0, range_m: 1_500_000.0 }),
            source: PresetSource::Earthquake(EarthquakeSource {
                mw: 7.4,
                depth_m: 25_000.0,
                strike_deg: 193.0,
                dip_deg: 16.0,
                rake_deg: 93.9,
                slip_m: 4.7,
                fault_length_m: 70_000.0,
                fault_width_m: 65_000.0,
                water_depth_m: 1_500.0,
                location: GeoPoint { lat_deg: 39.971, lon_deg: 143.0592, depth_m: 1_500.0 },
            }),
        },
        Preset {
            id: "lisbon_1755",
            name: "Lisbon Earthquake & Tsunami",
            date: "1755-11-01",
            blurb: "M_w ~8.7 thrust west of Gibraltar. Destroyed Lisbon, waves across the Atlantic to the Caribbean; shaped European Enlightenment thought. Source remains debated — this preset uses Barkan et al.'s best-fitting far-field source (Horseshoe Plain).",
            // Barkan, ten Brink & Lin 2009 (Marine Geology 264:109) Source 5,
            // Table 4 verbatim: 36.042°N −10.753°E (Horseshoe Plain), fault
            // 200 × 80 km, average slip 13.1 m, strike ~345°, dip 40°,
            // rake 90°, fault-top depth 5 km, M0 = 1.26e22 N·m (Mw ≈ 8.7).
            // Water depth at the Horseshoe Abyssal Plain is approximate (~4.8 km).
            reference: "Barkan, ten Brink & Lin 2009, Marine Geology 264:109, doi:10.1016/j.margeo.2009.04.020",
            reference_url: Some("https://pubs.usgs.gov/publication/70036556"),
            is_speculative: false,
            controversy_note: Some("The 1755 source fault is still debated; parameters are Barkan et al. 2009's preferred far-field source (their Source 5), not a consensus mechanism."),
            // Atlantic framing: Iberia + Morocco + open ocean to the WSW.
            camera_view: Some(CameraView { heading_deg: 320.0, pitch_deg: -50.0, range_m: 3_000_000.0 }),
            source: PresetSource::Earthquake(EarthquakeSource {
                mw: 8.7,
                depth_m: 5_000.0,
                strike_deg: 345.0,
                dip_deg: 40.0,
                rake_deg: 90.0,
                slip_m: 13.1,
                fault_length_m: 200_000.0,
                fault_width_m: 80_000.0,
                water_depth_m: 4_800.0,
                location: GeoPoint { lat_deg: 36.042, lon_deg: -10.753, depth_m: 4_800.0 },
            }),
        },
        Preset {
            id: "amorgos_1956",
            name: "Amorgos Earthquake & Tsunami",
            date: "1956-07-09",
            blurb: "M_w 7.7 normal-faulting event in the Santorini–Amorgos zone — the largest 20th-century Aegean earthquake. Up to 30 m local runup on Amorgos; Okal et al. attribute most of it to triggered submarine landslides, so this coseismic-only preset under-predicts the extreme local values.",
            // Okal et al. 2009 (GJI 178:1533): relocated epicenter
            // 36.72°N 25.76°E, M0 = 3.9e20 N·m (Mw 7.7), preferred
            // SE-dipping normal plane strike 39°, dip 25°, rake 246°
            // (represented here as −114°), moment-consistent slip 2.46 m,
            // 81 × 41 km fault, hypocentral depth ~30 km (relocation
            // constraint; Kalligeris et al. 2025 argue a steeper/shallower
            // 5–8 m-slip rupture). Aegean basin water depth approximate (~800 m).
            reference: "Okal et al. 2009, GJI 178:1533, doi:10.1111/j.1365-246X.2009.04237.x",
            reference_url: Some("https://academic.oup.com/gji/article/178/3/1533/595801"),
            is_speculative: false,
            controversy_note: Some("Okal 2009 concludes triggered submarine landslides — not the fault itself — drove the observed 30 m local runup; the coseismic source here under-predicts near-field extremes. Kalligeris 2025 proposes a steeper, shallower, larger-slip rupture."),
            // South-Aegean framing: Cyclades + Crete.
            camera_view: Some(CameraView { heading_deg: 0.0, pitch_deg: -50.0, range_m: 900_000.0 }),
            source: PresetSource::Earthquake(EarthquakeSource {
                mw: 7.7,
                depth_m: 30_000.0,
                strike_deg: 39.0,
                dip_deg: 25.0,
                rake_deg: -114.0,
                slip_m: 2.46,
                fault_length_m: 81_000.0,
                fault_width_m: 41_000.0,
                water_depth_m: 800.0,
                location: GeoPoint { lat_deg: 36.72, lon_deg: 25.76, depth_m: 800.0 },
            }),
        },
        Preset {
            id: "anak_krakatau_2018",
            name: "Anak Krakatau Flank Collapse",
            date: "2018-12-22",
            blurb: "0.27 km³ SW flank collapse of Anak Krakatau during eruption — no earthquake, no warning. ~50 m wave near the volcano, 400+ killed on Java and Sumatra coasts 35–45 minutes later. The defining modern argument for non-seismic tsunami monitoring.",
            // Grilli et al. 2019 (Sci Rep 9:11946): best-estimate collapse
            // volume 0.27 km³ (bounds 0.22–0.30), granular slide with solid
            // density 1900 kg/m³ at 40% porosity (bulk ≈ 1550 kg/m³),
            // pre-collapse edifice ~335 m ASL, discharge SW into the ~250 m
            // deep Krakatau caldera basin. The slope angle is derived, not
            // quoted: ~335 m + 250 m relief over the ~2 km subaerial-to-
            // caldera run gives ≈ 16°.
            reference: "Grilli et al. 2019, Scientific Reports 9:11946, doi:10.1038/s41598-019-48327-6",
            reference_url: Some("https://www.nature.com/articles/s41598-019-48327-6"),
            is_speculative: false,
            controversy_note: None,
            // Same Sunda Strait framing as the 1883 preset.
            camera_view: Some(CameraView { heading_deg: 0.0, pitch_deg: -45.0, range_m: 1_000_000.0 }),
            source: PresetSource::Landslide(LandslideSource {
                kind: crate::physics::landslide::LandslideKind::Subaerial,
                volume_m3: 2.7e8,
                density_kg_m3: 1_550.0,
                drop_height_m: 335.0,
                slope_deg: 16.0,
                water_depth_m: 250.0,
                water_body_width_m: 5_000.0,
                location: GeoPoint { lat_deg: -6.102, lon_deg: 105.423, depth_m: 250.0 },
            }),
        },
        Preset {
            id: "yr4_2032_whatif",
            name: "2024 YR4 Ocean Impact (What-If — Impact Ruled Out)",
            date: "—",
            blurb: "The asteroid behind the February 2025 news cycle (impact odds briefly ~3%, since ruled out). Viral posts claimed \"88 m waves\"; NASA's models say an airbursting ~60 m stony object is unlikely to cause a significant tsunami at all. This preset shows the UPPER BOUND if the intact body somehow reached the surface — compare its modest far-field wave with the viral claims.",
            // NASA 2024 YR4 facts page + JWST: diameter 60 ± 7 m; predicted
            // 2032 encounter velocity ~17.3 km/s; S-type spectral class →
            // stony density assumption 2600 kg/m³; 45° is the most probable
            // impact angle for any impactor (Shoemaker 1962). The location is
            // a representative point in the eastern equatorial Pacific
            // segment of the published (retired) risk corridor — no impact
            // point was ever predicted. Earth impact is RULED OUT.
            reference: "NASA Science: Asteroid 2024 YR4 facts (JWST size 60±7 m); JPL CNEOS Sentry (retired)",
            reference_url: Some("https://science.nasa.gov/solar-system/asteroids/2024-yr4-facts/"),
            is_speculative: true,
            controversy_note: Some("Myth-busting scenario: NASA states an airbursting object of this size is \"unlikely to cause significant tsunami\". Ward–Asphaug assumes the body reaches the water intact, so even this is an over-estimate — and Earth impact has been ruled out entirely."),
            camera_view: Some(CameraView { heading_deg: 0.0, pitch_deg: -55.0, range_m: 4_000_000.0 }),
            source: PresetSource::Asteroid(AsteroidImpact {
                diameter_m: 60.0,
                density_kg_m3: 2_600.0,
                velocity_m_s: 17_300.0,
                angle_deg: 45.0,
                water_depth_m: 3_500.0,
                location: GeoPoint { lat_deg: 5.0, lon_deg: -95.0, depth_m: 3_500.0 },
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

/// Process-wide cached registry. `all_presets()` rebuilds (and heap-allocates)
/// the full Vec on every call; `find_preset` is invoked on every `run_preset`,
/// so back lookups with a `OnceLock` and clone only the single match.
fn presets_cached() -> &'static [Preset] {
    static CACHE: std::sync::OnceLock<Vec<Preset>> = std::sync::OnceLock::new();
    CACHE.get_or_init(all_presets)
}

pub fn find_preset(id: &str) -> Option<Preset> {
    presets_cached().iter().find(|p| p.id == id).cloned()
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

    /// Every shipped preset must satisfy the same input bounds the live
    /// `*_initial_conditions` IPC commands enforce, so the curated preset path
    /// can never describe an event the custom-scenario path would reject.
    #[test]
    fn every_preset_source_is_within_command_bounds() {
        for p in all_presets() {
            let id = p.id;
            match &p.source {
                PresetSource::Asteroid(a) => {
                    assert!(a.diameter_m > 0.0, "{id}: diameter");
                    assert!(a.density_kg_m3 > 0.0, "{id}: density");
                    assert!(a.velocity_m_s > 0.0, "{id}: velocity");
                    assert!(a.angle_deg > 0.0 && a.angle_deg <= 90.0, "{id}: angle {}", a.angle_deg);
                    assert!((0.0..=12_000.0).contains(&a.water_depth_m), "{id}: water_depth");
                }
                PresetSource::Nuclear(n) => {
                    assert!(n.yield_kt > 0.0 && n.yield_kt <= 1.0e7, "{id}: yield {}", n.yield_kt);
                    assert!((0.0..=12_000.0).contains(&n.burst_depth_m), "{id}: burst_depth");
                    assert!((0.0..=12_000.0).contains(&n.water_depth_m), "{id}: water_depth");
                }
                PresetSource::Earthquake(e) => {
                    assert!((4.0..=10.5).contains(&e.mw), "{id}: mw {}", e.mw);
                    assert!((0.0..=700_000.0).contains(&e.depth_m), "{id}: depth");
                    assert!(e.dip_deg >= 0.0 && e.dip_deg <= 90.0, "{id}: dip");
                    assert!(e.slip_m >= 0.0, "{id}: slip");
                }
                PresetSource::Landslide(l) => {
                    assert!(l.volume_m3 > 0.0, "{id}: volume");
                    assert!(l.density_kg_m3 > 0.0, "{id}: density");
                    assert!(l.drop_height_m >= 0.0, "{id}: drop_height");
                    assert!(l.slope_deg >= 0.0 && l.slope_deg <= 90.0, "{id}: slope");
                    assert!(l.water_depth_m > 0.0, "{id}: water_depth");
                    assert!(l.water_body_width_m > 0.0, "{id}: water_body_width");
                }
                PresetSource::Meteotsunami(m) => {
                    assert!(m.peak_pressure_pa > 0.0, "{id}: pressure");
                    assert!(m.speed_m_s > 0.0, "{id}: speed");
                    assert!((0.0..360.0).contains(&m.heading_deg), "{id}: heading");
                    assert!(m.along_track_sigma_m > 0.0, "{id}: along-track sigma");
                    assert!(m.cross_track_sigma_m > 0.0, "{id}: cross-track sigma");
                    assert!(m.track_length_m > 0.0, "{id}: track length");
                    assert!(m.water_depth_m >= 50.0, "{id}: water depth");
                }
            }
            // Location domain matches check_lat_lon (lat ±90, lon ±180).
            let loc = match &p.source {
                PresetSource::Asteroid(a) => a.location,
                PresetSource::Nuclear(n) => n.location,
                PresetSource::Earthquake(e) => e.location,
                PresetSource::Landslide(l) => l.location,
                PresetSource::Meteotsunami(m) => m.location,
            };
            assert!(loc.lat_deg.abs() <= 90.0, "{id}: lat {}", loc.lat_deg);
            assert!(loc.lon_deg.abs() <= 180.0, "{id}: lon {}", loc.lon_deg);
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
