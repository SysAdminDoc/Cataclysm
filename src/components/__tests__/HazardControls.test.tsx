import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HazardControls } from "../HazardControls";
import type { AsteroidInput, AsteroidVisualReport, HazardResult, NuclearInput, NuclearShelterReport } from "../../hazards";
import { I18nProvider } from "../../lib/i18n";

const nuclear: NuclearInput = { yieldKt: 100, burstType: "airburst", populationDensity: 5000 };
const asteroid: AsteroidInput = { diameterM: 100, densityKgM3: 3000, velocityKmS: 20, angleDeg: 45, targetType: "sedimentary_rock", waterDepthM: 4000 };
const nuclearResult: HazardResult = {
  kind: "nuclear",
  authority: "rust",
  modelVersion: "nuclear-direct-1.0.0",
  center: { lat: 40, lon: -74 },
  rings: [{ label: "Fireball", radiusM: 300, color: "#f5e0dc", category: "fireball" }],
  readout: [{ label: "Fireball radius", value: "300 m" }],
  casualties: { deaths: 120, injuries: 240, childDeaths: 30, childInjuries: 60, populationDensity: 5000 },
  casualtyModels: [
    {
      id: "combined_effects",
      label: "Combined effects",
      version: "cataclysm-combined-effects-1.0",
      summary: "Combined screening.",
      assumptions: ["Uniform population."],
      citations: [{ label: "Glasstone & Dolan 1977", url: "https://www.osti.gov/biblio/6852629" }],
      estimate: { deaths: 120, injuries: 240, childDeaths: 30, childInjuries: 60, populationDensity: 5000 },
    },
    {
      id: "blast_proxy",
      label: "Blast-pressure proxy",
      version: "dcpa-ota-blast-proxy-1.0",
      summary: "Blast-only screening.",
      assumptions: ["Overpressure proxy."],
      citations: [{ label: "NUKEMAP methods note", url: "https://db.nuclearsecrecy.com/nukemap/faq/" }],
      estimate: { deaths: 80, injuries: 180, childDeaths: 20, childInjuries: 45, populationDensity: 5000 },
    },
  ],
  casualtySpread: { deathsMin: 80, deathsMax: 120, injuriesMin: 180, injuriesMax: 240 },
  detail: {
    yieldKt: 100,
    isSurface: false,
    isWater: false,
    fireball: 0.3,
    psi20: 1,
    psi5: 3,
    psi1: 8,
    thermal3: 4,
    thermal1: 6,
    radiation: 2,
    neutronRad: 1,
    gammaRad: 1,
    craterR: 0,
    cloudTopH: 12,
    optimalHeight: 1000,
    waveHeight: 0,
    fallout: null,
    timeline: [{ time: "0 ms", description: "Detonation.", category: "radiation" }],
    latentCancer: { exposed: 50000, cancers10yr: 800, cancers30yr: 2100, geneticEffects: 50 },
  },
};
const nuclearFalloutResult = {
  ...nuclearResult,
  detail: {
    ...nuclearResult.detail,
    fallout: {
      heavy: { length: 8, width: 2 },
      light: { length: 27, width: 5 },
    },
  },
} as HazardResult;
const asteroidResult: HazardResult = {
  kind: "asteroid",
  authority: "rust",
  modelVersion: "asteroid-direct-1.1.0",
  center: { lat: 40, lon: -74 },
  rings: [{ label: "Final crater", radiusM: 1_500, color: "#cba6f7", category: "crater" }],
  readout: [{ label: "Final crater", value: "3.0 km" }],
  detail: {
    kineticEnergyJ: 1e19,
    megatons: 2_390,
    impactorMassKg: 1e12,
    atmosphericEntry: {
      reachesGround: true,
      airburstAltitude: 0,
      airburstEnergy: 1e19,
      impactVelocity: 18_000,
      breakupAltitude: 35_000,
    },
    crater: { finalDiameter: 3_000, craterDepth: 600, isComplex: false },
    seismicMagnitude: 6,
    fireballRadiusM: 2_000,
    radiusWindowBreakageM: 10_000,
    radiusSevereDamageM: 5_000,
    radiusTotalDestructionM: 2_500,
    thermalRadiusFirstDegreeM: 12_000,
    thermalRadiusThirdDegreeM: 7_000,
    tsunami: {
      applies: false,
      cavityDiameter: 0,
      cavityDepth: 0,
      initialAmplitude: 0,
      amplitudeAtDistance: 0,
      runupHeight: 0,
      arrivalTime: 0,
    },
    secondaryEffects: {
      classification: "Extinction-scale screening",
      summary: "Quantitative near-field scaling plus cited Chicxulub-class climate scenarios.",
      durationSeconds: 31_536_000,
      seismicMagnitude: 6,
      ejectaReferenceDistanceM: 7_500,
      ejectaThicknessM: 12,
      events: [
        {
          id: "seismic-shaking",
          onsetSeconds: 5,
          timeLabel: "seconds",
          title: "Equivalent seismic shaking",
          summary: "Equivalent shaking begins near the source.",
          metricLabel: "Equivalent magnitude",
          metricValue: "M 6.0",
          category: "seismic",
          confidence: "quantitative_screening",
          uncertainty: "Equivalent magnitude does not predict local intensity.",
          citations: [{ label: "Collins et al. 2005", url: "https://doi.org/10.1111/j.1945-5100.2005.tb00157.x" }],
        },
        {
          id: "ejecta-blanket",
          onsetSeconds: 120,
          timeLabel: "minutes",
          title: "Ballistic ejecta blanket",
          summary: "The idealized blanket is 12 m thick at the reference distance.",
          metricLabel: "Thickness at 5 crater radii",
          metricValue: "12 m",
          category: "ejecta",
          confidence: "quantitative_screening",
          uncertainty: "Topography and impact angle change local deposition.",
          citations: [{ label: "Collins et al. 2005", url: "https://doi.org/10.1111/j.1945-5100.2005.tb00157.x" }],
        },
        {
          id: "climate-recovery",
          onsetSeconds: 31_536_000,
          timeLabel: "years",
          title: "Long climate recovery tail",
          summary: "Food-web disruption can persist beyond the first year.",
          metricLabel: "Published duration range",
          metricValue: "Months to more than a decade",
          category: "climate",
          confidence: "qualitative_scenario",
          uncertainty: "Published models do not support one universal recovery time.",
          citations: [{ label: "Senel et al. 2023", url: "https://www.nature.com/articles/s41561-023-01290-4" }],
        },
      ],
    },
  },
};
const asteroidVisuals: AsteroidVisualReport = {
  resultId: "asteroid-result",
  model: "asteroid-direct-1.1.0",
  trajectory: [
    { altitude: 100_000, velocity: 20_000, groundDistance: 0, time: 0 },
    { altitude: 35_000, velocity: 19_500, groundDistance: 65_000, time: 5 },
    { altitude: 0, velocity: 18_000, groundDistance: 100_000, time: 9 },
  ],
  crater: { finalDiameter: 3_000, craterDepth: 600, rimHeight: 120, isComplex: false },
};
const shelterReport: NuclearShelterReport = {
  resultId: "nuclear-result",
  model: "NukeMap shelter heuristic port 1.0",
  zones: [
    {
      label: "5 psi zone",
      distanceKm: 3,
      overpressurePsi: 5,
      thermalCalCm2: 10,
      shelters: [
        { shelterType: "Open air", survivalPct: 0, blastOk: false },
        { shelterType: "Deep underground", survivalPct: 100, blastOk: true },
      ],
    },
    {
      label: "1 psi zone",
      distanceKm: 8,
      overpressurePsi: 1,
      thermalCalCm2: 2,
      shelters: [
        { shelterType: "Open air", survivalPct: 75, blastOk: false },
        { shelterType: "Deep underground", survivalPct: 100, blastOk: true },
      ],
    },
  ],
  limitations: ["Educational screening only."],
};

function noop() {}

describe("HazardControls", () => {
  beforeEach(() => localStorage.clear());

  it("prompts to pick a location when no result is present", () => {
    render(
      <HazardControls
        mode="nuclear"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={null}
        onTogglePick={noop}
        pickActive={false}
        result={null}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );
    expect(screen.getByText(/pick a location/i)).toBeInTheDocument();
    expect(screen.getByText(/no location set/i)).toBeInTheDocument();
  });

  it("renders the nuclear readout, casualties, shelter screening and ring legend from a result", async () => {
    const user = userEvent.setup();
    render(
      <HazardControls
        mode="nuclear"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={nuclearResult}
        shelterReport={shelterReport}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );
    // Backend fixture values are presented without client-side recomputation.
    expect(screen.getByText("Fireball radius")).toBeInTheDocument();
    // casualties block renders fatalities
    expect(screen.getAllByText(/fatalities/i).length).toBeGreaterThanOrEqual(1);
    // latent cancer readout renders the BEIR VII estimate
    expect(screen.getByText(/latent\s*cancer deaths over 30 yr/i)).toBeInTheDocument();
    expect(screen.getByText(/BEIR VII/i)).toBeInTheDocument();
    // one legend entry per ring
    expect(screen.getByText("Fireball")).toBeInTheDocument();
    await user.click(screen.getByText("Shelter screening by effect zone"));
    const table = screen.getByRole("region", { name: "Shelter screening table" });
    expect(table).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("columnheader", { name: /5 psi zone 3 km/ })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Deep underground" })).toBeInTheDocument();
    expect(screen.getByText(/not personal survival odds/i)).toBeInTheDocument();
  });

  it("switches backend casualty models, shows their disagreement, and exposes sources", async () => {
    const user = userEvent.setup();
    render(
      <HazardControls
        mode="nuclear"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={nuclearResult}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );

    const picker = screen.getByRole("combobox", { name: "Immediate casualty model" });
    expect(picker).toHaveValue("combined_effects");
    expect(screen.getByText(/Model disagreement/)).toHaveTextContent(/fatalities 80–90 ↔ 100–200/);
    expect(screen.getByText(/Includes blast, thermal burns, and prompt radiation/)).toBeInTheDocument();

    await user.selectOptions(picker, "blast_proxy");
    expect(screen.getByText(/Uses blast overpressure alone/)).toBeInTheDocument();
    expect(screen.getByText("80–90")).toBeInTheDocument();
    await user.click(screen.getByText("Assumptions & sources"));
    expect(screen.getByRole("link", { name: "NUKEMAP methods note" })).toHaveAttribute(
      "href",
      "https://db.nuclearsecrecy.com/nukemap/faq/",
    );
  });

  it("converts direct-hazard readouts, rings, density, and shelter ranges to imperial", async () => {
    localStorage.setItem("tsunamisim.units", JSON.stringify("imperial"));
    render(
      <HazardControls
        mode="nuclear"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={nuclearResult}
        shelterReport={shelterReport}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );

    await waitFor(() => expect(screen.getAllByText("0.2 mi").length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText(/12,950 people\/mi²/)).toBeInTheDocument();
    expect(screen.queryByText("300 m")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /5 psi zone 1\.9 mi/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /High-altitude EMP \(248\.5 mi\)/ })).toBeInTheDocument();
  });

  it("renders accessible Rust-authoritative asteroid trajectory and crater diagrams", () => {
    render(
      <HazardControls
        mode="asteroid"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={asteroidResult}
        asteroidVisuals={asteroidVisuals}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );

    expect(screen.getByRole("heading", { name: "Impact profile" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Atmospheric entry trajectory/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Modeled crater cross-section/ })).toBeInTheDocument();
    expect(screen.getByText(/3 km diameter/)).toBeInTheDocument();
    expect(screen.getByText(/browser only draws the returned values/i)).toBeInTheDocument();
  });

  it("stages cited asteroid aftermath through the shared timeline selection", async () => {
    const onTimelineTimeChange = vi.fn();
    const user = userEvent.setup();
    render(
      <HazardControls
        mode="asteroid"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={asteroidResult}
        asteroidVisuals={asteroidVisuals}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
        timelineTimeS={31_536_000}
        onTimelineTimeChange={onTimelineTimeChange}
      />,
    );

    expect(screen.getByText("Long-term impact timeline")).toBeInTheDocument();
    expect(screen.getByText("Extinction-scale screening")).toBeInTheDocument();
    expect(screen.getByText("Months to more than a decade")).toBeInTheDocument();
    expect(screen.getByText("Qualitative literature scenario")).toBeInTheDocument();
    expect(screen.getByText(/one universal recovery time/i)).toBeInTheDocument();
    expect(screen.getByText("Senel et al. 2023")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Select minutes after impact: Ballistic ejecta blanket/i }));
    expect(onTimelineTimeChange).toHaveBeenCalledWith(120);
  });

  it("fires the pick toggle when the location button is clicked", () => {
    const onTogglePick = vi.fn();
    render(
      <HazardControls
        mode="asteroid"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={null}
        onTogglePick={onTogglePick}
        pickActive={false}
        result={null}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );
    screen.getByRole("button", { name: /pick location on globe/i }).click();
    expect(onTogglePick).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /pick location on globe/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("preserves a matching weapon preset and exposes formatted slider values", () => {
    render(
      <HazardControls
        mode="nuclear"
        nuclear={{ ...nuclear, yieldKt: 15 }}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={null}
        onTogglePick={noop}
        pickActive
        result={null}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );
    expect(screen.getByLabelText("Weapon preset")).toHaveValue("hiroshima");
    expect(screen.getByRole("slider", { name: "Yield quick adjust" })).toHaveAttribute("aria-valuetext", "15 kT");
    expect(screen.getByRole("button", { name: /click the globe/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("exposes high-altitude EMP without implying ground-effect rings", () => {
    render(
      <HazardControls
        mode="nuclear"
        nuclear={{ ...nuclear, burstType: "hemp", heightM: 400_000 }}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 16.28, lon: -169.53 }}
        onTogglePick={noop}
        pickActive={false}
        result={null}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
        workspaceMode="advanced"
      />,
    );
    expect(screen.getByLabelText("Burst type")).toHaveValue("hemp");
    expect(screen.getByRole("option", { name: "High-altitude EMP (400 km)" })).toBeInTheDocument();
    expect(screen.getByText(/suppresses ground blast, thermal, prompt-radiation, fallout, and casualty rings/i)).toBeInTheDocument();
  });

  it("explains that direct physics is desktop-only in browser preview", () => {
    render(
      <HazardControls
        mode="asteroid"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={null}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
        backendAvailable={false}
      />,
    );
    expect(screen.getByText(/requires the desktop app/i)).toBeInTheDocument();
  });

  it("surfaces calculation failures and exposes animation from Setup", () => {
    const { rerender } = render(
      <HazardControls
        mode="nuclear"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={null}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
        error="Direct hazard simulation failed: backend unavailable"
        display="setup"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("backend unavailable");

    rerender(
      <HazardControls
        mode="nuclear"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={nuclearResult}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
        display="setup"
        canAnimate
      />,
    );
    expect(screen.getByRole("button", { name: "Detonation animation" })).toBeEnabled();
  });

  it("commits an exact yield from the synchronized numeric input on blur", async () => {
    const onNuclearChange = vi.fn();
    const user = userEvent.setup();
    render(
      <HazardControls
        mode="nuclear"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={onNuclearChange}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={null}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );
    const input = screen.getByLabelText("Yield exact value");
    await user.clear(input);
    await user.type(input, "1234");
    await user.tab();
    expect(onNuclearChange).toHaveBeenLastCalledWith(expect.objectContaining({ yieldKt: 1234 }));
  });

  it("keeps an out-of-range exact entry editable and shows a specific error", async () => {
    const onNuclearChange = vi.fn();
    const user = userEvent.setup();
    render(
      <HazardControls
        mode="nuclear"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={onNuclearChange}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={null}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );
    const input = screen.getByLabelText("Yield exact value");
    await user.clear(input);
    await user.type(input, "999999999");
    await user.tab();
    expect(input).toHaveValue(999999999);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Yield must be between 0.001 and 100000.");
    expect(onNuclearChange).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "250");
    await user.keyboard("{Enter}");
    expect(onNuclearChange).toHaveBeenLastCalledWith(expect.objectContaining({ yieldKt: 250 }));
  });

  it.each([
    ["nuclear", ["Yield", "Population density", "Wind from"]],
    ["asteroid", ["Diameter", "Velocity", "Impact angle", "Density"]],
  ] as const)("links names, bounds, units, and values for every %s numeric field", (mode, labels) => {
    render(
      <HazardControls
        mode={mode}
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={null}
        onTogglePick={noop}
        pickActive={false}
        result={mode === "nuclear" ? nuclearFalloutResult : null}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
        workspaceMode="advanced"
      />,
    );
    for (const label of labels) {
      const exact = screen.getByRole("spinbutton", { name: `${label} exact value` });
      const slider = screen.getByRole("slider", { name: `${label} quick adjust` });
      expect(exact).toHaveAttribute("aria-invalid", "false");
      expect(slider).toHaveAttribute("aria-valuetext");
      for (const control of [exact, slider]) {
        const ids = control.getAttribute("aria-describedby")?.split(" ") ?? [];
        expect(ids.length).toBeGreaterThanOrEqual(2);
        ids.forEach((id) => expect(document.getElementById(id)).not.toBeNull());
      }
    }
  });

  it("presents direct consequences as order-of-magnitude display bands, not confidence intervals", () => {
    render(
      <HazardControls
        mode="nuclear"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={{
          ...nuclearResult,
          casualties: { deaths: 112019, injuries: 264055, childDeaths: 28005, childInjuries: 66014, populationDensity: 5000 },
          casualtyModels: undefined,
          casualtySpread: undefined,
        }}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );
    expect(screen.getByText("100,000–200,000")).toBeInTheDocument();
    expect(screen.getByText("200,000–300,000")).toBeInTheDocument();
    expect(screen.queryByText("112,019")).not.toBeInTheDocument();
    expect(screen.getByText(/not statistical confidence intervals/i)).toHaveTextContent(
      /uniformly distributed, with fixed indoor\/outdoor occupancy and shielding factors/i,
    );
  });

  it("labels latent-effect ranges as display bands with their model assumptions", () => {
    render(
      <HazardControls
        mode="nuclear"
        nuclear={nuclear}
        asteroid={asteroid}
        onNuclearChange={noop}
        onAsteroidChange={noop}
        center={{ lat: 40, lon: -74 }}
        onTogglePick={noop}
        pickActive={false}
        result={nuclearResult}
        windFromDeg={270}
        onWindChange={noop}
        onDetonate={noop}
      />,
    );
    expect(screen.getByText("2,000–3,000")).toBeInTheDocument();
    expect(screen.getByText("800–900")).toBeInTheDocument();
    expect(screen.getByText(/BEIR VII/i)).toHaveTextContent(/not confidence intervals/i);
    expect(screen.getByText(/BEIR VII/i)).toHaveTextContent(/50% outer-zone survivor assumption/i);
  });

  it("localizes direct-hazard setup, numeric controls, and diagrams in Japanese", () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    render(
      <I18nProvider>
        <HazardControls
          mode="asteroid"
          nuclear={nuclear}
          asteroid={asteroid}
          onNuclearChange={noop}
          onAsteroidChange={noop}
          center={{ lat: 40, lon: -74 }}
          onTogglePick={noop}
          pickActive={false}
          result={asteroidResult}
          asteroidVisuals={asteroidVisuals}
          windFromDeg={270}
          onWindChange={noop}
          onDetonate={noop}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("小惑星衝突")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "直径 正確な値" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "衝突対象" })).toHaveValue("sedimentary_rock");
    expect(screen.getByRole("heading", { name: "衝突プロファイル" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /大気圏突入軌道/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /モデル化したクレーター断面/ })).toBeInTheDocument();
  });
});
