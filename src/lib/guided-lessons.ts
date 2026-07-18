export type LessonStep = {
  title: string;
  body: string;
};

export type GuidedLesson = {
  id: string;
  title: string;
  presetId: string;
  summary: string;
  steps: LessonStep[];
  /** Printable worksheet prompts (classroom handout). Rendered by the
   *  lesson dialog's "Print worksheet" action via the print stylesheet. */
  worksheet: string[];
};

export const GUIDED_LESSONS: GuidedLesson[] = [
  {
    id: "chicxulub-extinction",
    title: "Chicxulub: The extinction-level tsunami",
    presetId: "chicxulub",
    summary:
      "Explore the largest asteroid impact in the geological record and understand how impact energy translates to ocean-scale wave generation.",
    steps: [
      {
        title: "Source: why this matters",
        body:
          "A 14 km asteroid striking shallow water released ~10⁸ Mt of energy. Ward & Asphaug 2000 models this as a transient water cavity whose radius and depth set the initial wave amplitude. Notice the cavity radius in the readout — that is the starting point for everything that follows.",
      },
      {
        title: "Propagation: what to watch",
        body:
          "Run the SWE solver and watch the ring wave expand. The amplitude decays as r^(−5/6) for impact sources — much faster than earthquake tsunamis (r^(−1/2)). By 1,000 km the wave is meters, not kilometres. Deep-ocean propagation speed (~200 m/s in 4 km depth) controls arrival times.",
      },
      {
        title: "Model limitations",
        body:
          "This is a linear long-wave / shallow-water approximation. Chicxulub's short wavelengths violate the shallow-water assumption near the source. Operational models (GeoClaw, MOST) use Boussinesq dispersion and AMR meshes for this regime. Our far-field arrival times and coastal runup remain useful first-order estimates.",
      },
      {
        title: "Next steps",
        body:
          "Export the results as KML to overlay in Google Earth, or save as CSV to compare arrival times. Try changing water depth or impact angle in the scenario builder to see how they affect the initial cavity and downstream propagation.",
      },
    ],
    worksheet: [
      "Record the cavity radius and peak amplitude from the source readout. How does the cavity radius compare with the 14 km impactor diameter?",
      "Run the solver and watch the ring wave. Using the r^(−5/6) impact decay, estimate how much the amplitude drops between 100 km and 1,000 km from the source.",
      "Pick two coastal points at different distances. Which one sees the wave first, and roughly how fast is the wavefront travelling between them?",
      "The lesson notes this model has no Boussinesq dispersion. In one sentence, why does that matter more for impact tsunamis than for earthquake tsunamis?",
    ],
  },
  {
    id: "tohoku-earthquake",
    title: "Tōhoku 2011: Modern megathrust tsunami",
    presetId: "tohoku_2011",
    summary:
      "Study how seafloor displacement from a M9.1 earthquake generates a tsunami, and compare model output against real DART buoy observations.",
    steps: [
      {
        title: "Source: Okada fault model",
        body:
          "The Okada 1985 model computes vertical seafloor displacement from fault geometry (strike, dip, rake, slip). For Tōhoku, ~30 m of slip on a 500 km × 200 km fault produces ~7 m of uplift. This displacement is the initial condition for wave propagation — no explosion or cavity, just a large area of raised and lowered ocean floor.",
      },
      {
        title: "DART buoy observations",
        body:
          "Real-world DART buoys recorded this event. When you load this preset, the DART observation sparklines appear alongside the model’s predicted arrival times. The agreement in arrival time is typically good; amplitude agreement depends on bathymetry resolution and source model fidelity.",
      },
      {
        title: "Model limitations",
        body:
          "We use a static dislocation — the fault ruptures instantly in our model, but the real Tōhoku rupture propagated north over ~3 minutes. This affects near-field waveform shape but not far-field arrival times. Runup estimates use Synolakis 1987 analytical law, not full wetting/drying.",
      },
      {
        title: "Next steps",
        body:
          "Place gauges at coastal cities around the Pacific to see arrival times. Export the gauge CSV and compare against published DART records. Try the Indian Ocean 2004 preset for a similar megathrust event with different fault geometry.",
      },
    ],
    worksheet: [
      "Record the fault dimensions and slip from the source readout, then compute fault area × slip. Why is this product a better hazard indicator than magnitude alone?",
      "Run the solver and open the DART overlay. For one buoy, compare the model arrival time against the observed arrival marker — how many minutes apart are they?",
      "Compare the peak amplitude at the buoy with the runup value at the nearest coastal point. Why is the coastal value so much larger?",
      "Name one assumption of the static Okada source (the lesson lists several) and describe how it could change the modelled wave.",
    ],
  },
  {
    id: "lituya-bay",
    title: "Lituya Bay 1958: Record runup in a fjord",
    presetId: "lituya_bay_1958",
    summary:
      "Understand how a landslide in a confined fjord produced the highest recorded wave runup in history — 524 metres.",
    steps: [
      {
        title: "Source: landslide mechanics",
        body:
          "A M7.8 earthquake triggered a 30 million m³ rockslide into the narrow inlet. Fritz & Hager 2001 showed this is a 2D impulse-wave problem: the slide volume, drop height, and impact angle determine the initial wave at the impact point. The Heller–Hager empirical formula calibrated against 350+ lab experiments is used here.",
      },
      {
        title: "Why 524 m runup?",
        body:
          "Confined geometry is the key. In open ocean, the wave spreads in all directions and decays. In Lituya Bay, the wave was channelled by steep fjord walls, focusing energy into a narrow strip. The Synolakis runup law applied to this steep slope produces extreme heights that match the geological trim line.",
      },
      {
        title: "Model limitations",
        body:
          "Our model uses the analytical Heller–Hager amplitude at the source, then propagates via SWE. Real fjord dynamics involve wave reflection, bore formation, and 3D bathymetry effects that our coarse grid cannot resolve. The 524 m figure is the observed trim line, not a model prediction.",
      },
    ],
    worksheet: [
      "Record the slide volume and drop height. Using energy ≈ m·g·h, estimate the potential energy the rockslide delivered to the water.",
      "The observed 1958 runup was 524 m. What does the simulator predict at the nearest coastal point, and what geometric effect explains the gap?",
      "Why do impulse waves in a confined fjord decay so much faster with distance than ocean-basin tsunamis?",
      "Sketch (or describe) the difference between this landslide source and an earthquake source of the same energy.",
    ],
  },
  {
    id: "poseidon-debunk",
    title: "Russia’s Poseidon: Propaganda vs physics",
    presetId: "poseidon_realistic",
    summary:
      "Compare a 100 Mt underwater nuclear detonation at realistic physics efficiency against Russian state media claims, and understand why the “500 m wave” claim violates energy conservation.",
    steps: [
      {
        title: "Source: what the physics says",
        body:
          "The 1996 Defense Nuclear Agency study measured underwater nuclear explosion wave-generation efficiency at ~5%. A 100 Mt warhead (4.184 × 10¹⁷ J) converts ~2 × 10¹⁶ J into wave energy. At 100 km in open ocean, this produces a wave of a few metres — significant for a harbour but not a city-killer.",
      },
      {
        title: "Try the comparison",
        body:
          "Use Compare mode (toolbar) to view the “realistic” and “propaganda” presets side by side. The propaganda preset applies the full yield without the 5% efficiency cap. Notice the difference in cavity radius and peak amplitude — the propaganda version violates known energy partition from underwater nuclear tests.",
      },
      {
        title: "Model limitations",
        body:
          "Our model uses Glasstone–Dolan + Le Méhauté formulas for underwater nuclear explosions, which are well-validated against actual nuclear test data. The main uncertainty is whether a 100 Mt device is even physically constructible at torpedo scale — we model the physics, not the engineering.",
      },
    ],
    worksheet: [
      "Run both Poseidon presets in Compare mode. Record the wave amplitude at 100 km for each. What is the ratio between the propaganda and realistic claims?",
      "Only ~5% of a nuclear detonation's energy couples into water waves. Where does the rest of the energy go?",
      "Using the attenuation chart, at what range does even the 100 Mt scenario fall below 1 m amplitude?",
      "In two sentences: why does energy conservation rule out the '500 m wall of water' claim?",
    ],
  },
  {
    id: "hunga-tonga",
    title: "Hunga Tonga 2022: Atmospheric Lamb-wave coupling",
    presetId: "hunga_tonga_2022",
    summary:
      "Explore the novel phenomenon where an atmospheric pressure wave, not just the ocean surface, drove global tsunami signals thousands of kilometres from the eruption.",
    steps: [
      {
        title: "Source: volcanic caldera collapse",
        body:
          "The VEI 5–6 eruption generated a 15 m local tsunami through submarine caldera collapse. But the globally significant signal came from a different mechanism: an atmospheric Lamb wave travelling at ~310 m/s coupled energy into the ocean surface worldwide. This was the first well-instrumented example of this phenomenon.",
      },
      {
        title: "Lamb-wave toggle",
        body:
          "In the SWE solver panel, toggle “Atmospheric Lamb wave” on and off. With it off, only the submarine collapse drives the wave. With it on, a secondary wavefront appears at a characteristic velocity faster than the ocean surface wave. This is a first-order approximation of the atmospheric coupling.",
      },
      {
        title: "Model limitations",
        body:
          "Full Lamb-wave–ocean coupling (Carvajal 2022, Matoza 2022) is a research frontier requiring coupled atmosphere–ocean models. Our implementation injects an additional IC pulse at the Lamb-wave speed — a pedagogical approximation, not a full atmospheric simulation. The volcanic source itself uses a nuclear-burst proxy, not a dedicated caldera collapse model.",
      },
    ],
    worksheet: [
      "Run the solver twice — once with the Lamb wave toggle off, once on. Describe the difference you see in the wavefield.",
      "The Lamb wave travels at ~310 m/s and the ocean wave at √(gh). For 4,000 m depth, which is faster and by how much?",
      "Why did tide gauges on the far side of the Pacific record waves EARLIER than a pure ocean-wave model predicts for this event?",
      "The lesson calls the Lamb-wave injection 'a pedagogical approximation'. What would a research-grade model have to couple that this one does not?",
    ],
  },
  {
    id: "sanriku-warning-worked",
    title: "Sanriku 2026: The warning worked",
    presetId: "sanriku_2026",
    summary:
      "A modest tsunami off the same coast Tōhoku devastated in 2011 — and this time the story is about a warning system doing its job.",
    steps: [
      {
        title: "A familiar coastline",
        body:
          "The 2026-04-20 M_w 7.4 thrust ruptured the Japan Trench interface off Sanriku — the same subduction zone as Tōhoku 2011, at roughly 1/300th the energy (magnitude is logarithmic: each whole step is ~32× the energy). Run the solver and compare the wave heights with the Tōhoku preset at the same coastal points.",
      },
      {
        title: "Seventeen minutes",
        body:
          "NOAA's forecast system detected the tsunami on a coastal tide gauge 17 minutes after rupture and had already produced propagation forecasts from pre-computed models. Deep-ocean DART pressure sensors, coastal gauges, and rapid seismic solutions (the same W-phase mechanism this preset uses) form a chain designed in large part from the lessons of 2004 and 2011.",
      },
      {
        title: "Why magnitude alone misleads",
        body:
          "M 7.4 sounds close to M 7.7 (the JMA estimate for this event) or even M 9.1, but seafloor displacement — what actually makes a tsunami — scales with fault area × slip. Inspect the source readout: ~4.7 m of slip over ~70 × 65 km, versus Tōhoku's ~30 m over 500 × 200 km. That is why warnings quote expected wave heights, not just magnitudes.",
      },
    ],
    worksheet: [
      "Record magnitude, fault area, and slip for this event and for Tōhoku 2011. Compute fault area × slip for both — how many times larger was Tōhoku?",
      "A tide gauge confirmed the tsunami 17 minutes after rupture. List two other observation systems in the warning chain and what each contributes.",
      "Run the solver. What peak amplitude does the model give at the nearest coastal point, and would that justify an evacuation order?",
      "Why do warning centres quote expected wave heights rather than earthquake magnitudes in public alerts?",
    ],
  },
  {
    id: "yr4-myth-busting",
    title: "2024 YR4: Anatomy of a viral tsunami myth",
    presetId: "yr4_2032_whatif",
    summary:
      "When impact odds briefly hit ~3% in February 2025, posts claimed 88 m waves. The physics says an object this size probably never touches the water.",
    steps: [
      {
        title: "What the models actually say",
        body:
          "NASA's assessment of the (since retired) 2032 scenario: an airbursting object of this size would be \"unlikely to cause significant tsunami, either from the middle of the ocean or even nearer shore.\" A ~60 m stony body deposits most of its energy in the atmosphere — like Tunguska 1908, which flattened forest but generated no tsunami-scale wave.",
      },
      {
        title: "Even the upper bound is modest",
        body:
          "This preset feeds Ward–Asphaug the impossible best case: the intact 60 m body reaching the surface at 17.3 km/s. Check the readout — the cavity is small, and the r^(−5/6) impact decay shreds the amplitude within tens of kilometres. Compare that with the viral \"88 m wave\" claims, which confused near-cavity amplitude with coastal wave height.",
      },
      {
        title: "How to read asteroid headlines",
        body:
          "Impact probability estimates legitimately fluctuate as orbits are refined — YR4's rose to ~3% before falling to zero, exactly as the process is designed to work. The lesson: check the object's size class first. Regional tsunami risk starts with impactors several hundred metres across; kilometre-class bodies are the global-hazard regime (see the Eltanin and Chicxulub presets).",
      },
    ],
    worksheet: [
      "Record the impactor diameter, velocity, and cavity radius. How does this cavity compare with Chicxulub's?",
      "NASA says an object this size would probably airburst. What happens to the impact energy in an airburst, and why does that suppress tsunami generation?",
      "Even in this reached-the-surface upper bound, what amplitude does the model give 100 km from the impact point?",
      "Write a two-sentence reply to a social-media post claiming this asteroid would cause '88 m waves'.",
    ],
  },
];

type GuidedLessonTranslation = Pick<GuidedLesson, "title" | "summary" | "steps" | "worksheet">;
type TranslatedLocale = Exclude<Locale, "en">;

const TRANSLATED_LESSONS: Record<TranslatedLocale, Record<string, GuidedLessonTranslation>> = {
  es: lessonsEs,
  ja: lessonsJa,
  id: lessonsId,
};

function hasCompleteLessonTranslation(
  canonical: GuidedLesson,
  translation: GuidedLessonTranslation | undefined,
): translation is GuidedLessonTranslation {
  return Boolean(
    translation
    && translation.title.trim()
    && translation.summary.trim()
    && translation.steps.length === canonical.steps.length
    && translation.steps.every((step) => step.title.trim() && step.body.trim())
    && translation.worksheet.length === canonical.worksheet.length
    && translation.worksheet.every((question) => question.trim()),
  );
}

export function getGuidedLessons(locale: Locale = "en"): GuidedLesson[] {
  if (locale === "en") return GUIDED_LESSONS;
  return GUIDED_LESSONS.map((canonical) => {
    const translation = TRANSLATED_LESSONS[locale][canonical.id];
    if (!hasCompleteLessonTranslation(canonical, translation)) {
      warnMissingTranslation(locale, `guidedLessons.${canonical.id}`);
      return canonical;
    }
    return { ...canonical, ...translation };
  });
}
import lessonsEs from "../data/i18n/guided-lessons.es.json";
import lessonsJa from "../data/i18n/guided-lessons.ja.json";
import lessonsId from "../data/i18n/guided-lessons.id.json";
import { warnMissingTranslation, type Locale } from "./i18n-core";
