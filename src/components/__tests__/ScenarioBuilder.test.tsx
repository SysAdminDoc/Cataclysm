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
    expect(await screen.findByRole("status")).toHaveTextContent("Pasted legacy scenario.");

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
    expect(await screen.findByRole("status")).toHaveTextContent("Loaded legacy scenario.");

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
});
