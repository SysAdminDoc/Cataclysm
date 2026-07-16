import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioBuilder } from "../ScenarioBuilder";
import {
  INITIAL_ASTEROID,
  INITIAL_EARTHQUAKE,
  INITIAL_NUCLEAR,
  SCENARIO_SCHEMA_VERSION,
} from "../../lib/scenario-schema";
import { settings } from "../../lib/settings";

const clipboard = {
  readText: vi.fn<() => Promise<string>>(),
  writeText: vi.fn<(text: string) => Promise<void>>(),
};

function renderBuilder(onSimulate = vi.fn()) {
  render(
    <ScenarioBuilder
      onSimulate={onSimulate}
      pickedLocation={null}
      onTogglePick={() => {}}
      pickActive={false}
    />,
  );
  return onSimulate;
}

function setupUser() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
  return user;
}

function setupUserWithoutClipboard() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
  return user;
}

describe("ScenarioBuilder scenario persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    clipboard.readText.mockReset();
    clipboard.writeText.mockReset();
  });

  it("copies versioned scenario payloads", async () => {
    clipboard.writeText.mockResolvedValue(undefined);
    const user = setupUser();
    renderBuilder();

    await user.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalled());
    const payload = JSON.parse(clipboard.writeText.mock.calls[0][0]) as {
      schemaVersion: number;
      kind: string;
    };
    expect(payload.schemaVersion).toBe(SCENARIO_SCHEMA_VERSION);
    expect(payload.kind).toBe("Asteroid");
    expect(await screen.findByRole("status")).toHaveTextContent("Copied scenario.");
  });

  it("surfaces clipboard write failures", async () => {
    clipboard.writeText.mockRejectedValue(new Error("denied"));
    const user = setupUser();
    renderBuilder();

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed.");
  });

  it("surfaces unavailable clipboard when copying", async () => {
    const user = setupUserWithoutClipboard();
    renderBuilder();

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed: clipboard is unavailable.");
  });

  it("saves and deletes scenarios from the saved list", async () => {
    const user = setupUser();
    renderBuilder();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved scenario.");
    await waitFor(() => expect(screen.getByRole("button", { name: /Load \(1\)/ })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Load \(1\)/ }));
    const savedList = document.querySelector(".scenario-saved");
    expect(savedList).not.toBeNull();
    expect(savedList?.querySelector(".scenario-saved__load")).toHaveTextContent(/^Asteroid/);
    await user.click(screen.getByLabelText(/Delete Asteroid/));

    await waitFor(() => expect(screen.getByText("No saved scenarios yet.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Load" })).toBeInTheDocument();
  });

  it("distinguishes a saved-scenario load failure from an empty library and retries locally", async () => {
    const user = setupUser();
    const loadSpy = vi.spyOn(settings, "getSavedScenarios")
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValueOnce([]);
    try {
      renderBuilder();
      await user.click(screen.getByRole("button", { name: "Load" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't load saved scenarios: storage unavailable/);
      await user.click(screen.getByRole("button", { name: "Retry saved scenarios" }));
      expect(await screen.findByText("No saved scenarios yet.")).toBeInTheDocument();
    } finally {
      loadSpy.mockRestore();
    }
  });

  it("undoes deletion with the same saved scenario identity and content", async () => {
    const user = setupUser();
    renderBuilder();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Load \(1\)/ })).toBeInTheDocument());
    const before = localStorage.getItem("tsunamisim.saved_scenarios");
    await user.click(screen.getByRole("button", { name: /Load \(1\)/ }));
    await user.click(screen.getByLabelText(/Delete Asteroid/));
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByLabelText(/Delete Asteroid/)).toBeInTheDocument());
    await waitFor(() => expect(localStorage.getItem("tsunamisim.saved_scenarios")).toBe(before));
    expect(await screen.findByRole("status")).toHaveTextContent(/^Restored Asteroid/);
  });

  it("restores an optimistically deleted row when persistence rejects", async () => {
    const user = setupUser();
    renderBuilder();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Load \(1\)/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Load \(1\)/ }));
    const before = localStorage.getItem("tsunamisim.saved_scenarios");
    const storageSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("injected delete failure");
    });
    try {
      await user.click(screen.getByLabelText(/Delete Asteroid/));
      expect(await screen.findByRole("alert")).toHaveTextContent(/Delete failed:.*All persisted values were restored/);
      expect(screen.getByLabelText(/Delete Asteroid/)).toBeInTheDocument();
      expect(localStorage.getItem("tsunamisim.saved_scenarios")).toBe(before);
    } finally {
      storageSpy.mockRestore();
    }
  });

  it("rejects pasted out-of-range payloads without changing visible scenario state", async () => {
    clipboard.readText.mockResolvedValue(JSON.stringify({
      kind: "Asteroid",
      source: {
        ...INITIAL_ASTEROID,
        diameter_m: 100_000,
      },
    }));
    const user = setupUser();
    const onSimulate = renderBuilder();

    await user.click(screen.getByRole("button", { name: "Paste" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Paste rejected: Diameter.*50,000/);
    await user.click(screen.getByRole("button", { name: "Simulate" }));
    expect(onSimulate).toHaveBeenCalledWith({
      kind: "Asteroid",
      source: INITIAL_ASTEROID,
    });
  });

  it("blocks simulation when an exact numeric draft is invalid", async () => {
    const user = setupUser();
    const onSimulate = renderBuilder();
    const diameter = screen.getByRole("spinbutton", { name: /Diameter.*exact value/i });

    await user.clear(diameter);
    await user.type(diameter, "100000");
    await user.click(screen.getByRole("button", { name: "Simulate" }));

    expect(onSimulate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Diameter.*between/i);
  });

  it("surfaces unavailable clipboard when pasting", async () => {
    const user = setupUserWithoutClipboard();
    renderBuilder();

    await user.click(screen.getByRole("button", { name: "Paste" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Paste failed: clipboard is unavailable.");
  });

  it("migrates valid legacy clipboard payloads before simulation", async () => {
    clipboard.readText.mockResolvedValue(JSON.stringify({
      kind: "Nuclear",
      source: {
        ...INITIAL_NUCLEAR,
        yield_kt: 25,
      },
    }));
    const user = setupUser();
    const onSimulate = renderBuilder();

    await user.click(screen.getByRole("button", { name: "Paste" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Pasted scenario (added schemaVersion 1).",
    );

    await user.click(screen.getByRole("button", { name: "Simulate" }));
    expect(onSimulate).toHaveBeenCalledWith({
      kind: "Nuclear",
      source: {
        ...INITIAL_NUCLEAR,
        yield_kt: 25,
      },
    });
  });

  it("migrates valid legacy saved scenarios before loading", async () => {
    const legacyEarthquake = { ...INITIAL_EARTHQUAKE, mw: 7.4 };
    delete legacyEarthquake.fault_length_m;
    delete legacyEarthquake.fault_width_m;
    localStorage.setItem("tsunamisim.saved_scenarios", JSON.stringify([
      {
        name: "Old quake",
        savedAt: "2026-06-17T00:00:00.000Z",
        data: {
          kind: "Earthquake",
          source: legacyEarthquake,
        },
      },
    ]));

    const user = setupUser();
    const onSimulate = renderBuilder();

    await user.click(await screen.findByRole("button", { name: /Load \(1\)/ }));
    await user.click(screen.getByRole("button", { name: "Old quake" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Loaded scenario (added schemaVersion 1).",
    );

    await user.click(screen.getByRole("button", { name: "Simulate" }));
    expect(onSimulate).toHaveBeenCalledWith({
      kind: "Earthquake",
      source: {
        ...legacyEarthquake,
        fault_length_m: 0,
        fault_width_m: 0,
      },
    });
  });

  it("keeps blank scientific inputs editable and explains the validation error", async () => {
    const user = setupUser();
    renderBuilder();
    const diameter = document.querySelector<HTMLInputElement>(
      '.scenario-field input[type="number"]',
    );
    expect(diameter).not.toBeNull();
    await user.clear(diameter!);
    await user.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Diameter.*must be a number/);
    expect(diameter).toHaveValue(null);
    expect(diameter).toHaveAttribute("aria-invalid", "true");
    expect(diameter).toHaveAccessibleName("Diameter (m) exact value");
  });

  it("gives every numeric field a distinct exact control and coarse slider relationship", async () => {
    const user = setupUser();
    renderBuilder();
    const fieldsByTab = {
      Asteroid: ["Diameter (m)", "Density (kg/m³)", "Velocity (m/s)", "Angle (°)", "Latitude (°)", "Longitude (°)", "Water depth (m)"],
      Nuclear: ["Yield (kt TNT)", "Burst depth (m)", "Latitude (°)", "Longitude (°)", "Water depth (m)"],
      Earthquake: ["Magnitude (M_w)", "Hypocentre depth (m)", "Strike (°)", "Dip (°)", "Rake (°)", "Slip (m)", "Fault length (m, 0 = auto)", "Fault width (m, 0 = auto)", "Latitude (°)", "Longitude (°)", "Water depth (m)"],
      Landslide: ["Volume (m³)", "Density (kg/m³)", "Drop height (m)", "Slope (°)", "Receiving body width (m)", "Latitude (°)", "Longitude (°)", "Water depth (m)"],
    } as const;

    for (const [tab, fields] of Object.entries(fieldsByTab)) {
      await user.click(screen.getByRole("tab", { name: tab }));
      for (const label of fields) {
        const exact = screen.getByRole("spinbutton", { name: `${label} exact value` });
        const describedBy = exact.getAttribute("aria-describedby")?.split(" ") ?? [];
        expect(describedBy.length).toBeGreaterThan(0);
        describedBy.forEach((id) => expect(document.getElementById(id)).not.toBeNull());
        const group = screen.getByRole("group", { name: label });
        expect(group.querySelector("label")?.querySelector("input, button, select")).toBeNull();
        const help = screen.getByRole("button", { name: `About ${label}` });
        const helpId = help.getAttribute("aria-controls");
        expect(helpId).toBeTruthy();
      }
      for (const slider of screen.queryAllByRole("slider")) {
        expect(slider).toHaveAccessibleName(/coarse slider$/);
        expect(slider).toHaveAttribute("aria-valuetext");
        slider.getAttribute("aria-describedby")?.split(" ").forEach((id) => {
          expect(document.getElementById(id)).not.toBeNull();
        });
      }
    }
  });

  it("loads an active source into the editor", async () => {
    render(
      <ScenarioBuilder
        onSimulate={vi.fn()}
        editRequest={{
          id: 1,
          scenario: { kind: "Asteroid", source: { ...INITIAL_ASTEROID, diameter_m: 14_000 } },
        }}
        pickedLocation={null}
        onTogglePick={vi.fn()}
        pickActive={false}
      />,
    );

    await waitFor(() => expect(
      document.querySelector<HTMLInputElement>('.scenario-field input[type="number"]'),
    ).toHaveValue(14_000));
  });

  it("auto-fills fault geometry from the nearest subduction zone", async () => {
    const user = setupUser();
    renderBuilder();
    await user.click(screen.getByRole("tab", { name: "Earthquake" }));

    // Perturb strike away from the default Tohoku value so the auto-fill is observable.
    const strike = screen.getByRole("spinbutton", { name: "Strike (°) exact value" });
    await user.clear(strike);
    await user.type(strike, "10");

    await user.click(
      screen.getByRole("button", { name: /auto-fill fault from subduction zone/i }),
    );

    // Default epicentre (38°N, 143°E) resolves to the Japan Trench (strike 195, dip 12).
    await waitFor(() => expect(strike).toHaveValue(195));
    expect(
      screen.getByRole("spinbutton", { name: "Dip (°) exact value" }),
    ).toHaveValue(12);
    expect(screen.getByText(/Japan Trench/i)).toBeInTheDocument();
  });

  it("warns when the epicentre is not near a mapped subduction zone", async () => {
    const user = setupUser();
    renderBuilder();
    await user.click(screen.getByRole("tab", { name: "Earthquake" }));

    // Move the epicentre to the mid-Atlantic, far from any mapped zone.
    const lat = screen.getByRole("spinbutton", { name: "Latitude (°) exact value" });
    const lon = screen.getByRole("spinbutton", { name: "Longitude (°) exact value" });
    await user.clear(lat);
    await user.type(lat, "30");
    await user.clear(lon);
    await user.type(lon, "-40");

    await user.click(
      screen.getByRole("button", { name: /auto-fill fault from subduction zone/i }),
    );

    expect(
      await screen.findByText(/No mapped subduction zone in range/i),
    ).toBeInTheDocument();
  });
});
