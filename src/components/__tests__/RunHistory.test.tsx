import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RunArchiveRecord, RunArchiveSnapshot } from "../../lib/run-archive";

const archive = vi.hoisted(() => ({
  list: vi.fn(),
  preview: vi.fn(),
  add: vi.fn(),
  setPinned: vi.fn(),
  touch: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  setQuota: vi.fn(),
}));

vi.mock("../../lib/run-archive", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/run-archive")>();
  return { ...original, runArchiveStore: archive };
});

import { RunHistory } from "../RunHistory";

function run(id: string, label: string, status: "pass" | "warning", peak: number): RunArchiveRecord {
  return {
    id,
    parentRunId: null,
    createdAt: "2026-07-21T12:00:00.000Z",
    lastAccessedAt: "2026-07-21T12:00:00.000Z",
    pinned: id === "run-a",
    label,
    presetId: null,
    scenarioKind: "Asteroid",
    inputs: {
      scenario: { kind: "Asteroid", source: {} } as RunArchiveRecord["inputs"]["scenario"],
      solverSettings: { duration_s: 3600 } as RunArchiveRecord["inputs"]["solverSettings"],
    },
    identity: {
      appVersion: "0.14.0",
      solverVersion: "0.14.0",
      scenarioSchemaVersion: 1,
      archiveSchemaVersion: 1,
      scenarioSha256: id === "run-a" ? "a".repeat(64) : "b".repeat(64),
      settingsSha256: "c".repeat(64),
      dataSha256: "d".repeat(64),
      renderProtocolVersion: "1.0",
    },
    summary: { durationS: 3600, frameCount: id === "run-a" ? 60 : 30, grid: { nx: 100, ny: 80 }, peakAbsMaxM: peak, gaugeCount: 0, gaugeSampleCount: 0 },
    quality: { status, finite_fields: true, minimum_total_depth_m: 1, cfl_number: 0.4, cfl_margin: 0.6, accepted_steps: 10, rejected_steps: 0, mass_drift_pct: 0, energy_drift_pct: 0, sponge_width_cells: 8, warnings: status === "warning" ? ["fixture"] : [], failure: null },
    provenance: {},
    scientificExport: null,
    logTail: [],
    results: { snapshots: [], maxField: null, gauges: [], runQuality: {} as RunArchiveRecord["results"]["runQuality"], isochrones: [] },
    sizeBytes: 2048,
  };
}

const RUNS = [run("run-a", "Pinned pass", "pass", 2), run("run-b", "Warning run", "warning", 5)];

function snapshot(): RunArchiveSnapshot {
  return { records: RUNS, trash: [], quarantine: [], quotaBytes: 128 * 1024 * 1024, usedBytes: 4096 };
}

describe("RunHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    archive.list.mockResolvedValue(snapshot());
    archive.touch.mockResolvedValue(undefined);
    archive.remove.mockResolvedValue(undefined);
    archive.setPinned.mockResolvedValue(undefined);
    archive.setQuota.mockResolvedValue({ fits: true, evictionIds: [] });
  });

  it("filters, compares, and reopens immutable archived runs", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<RunHistory pendingRecord={null} onPendingResolved={() => {}} onClose={() => {}} onOpen={onOpen} onRerun={() => {}} />);

    expect(await screen.findByRole("heading", { name: "Run history" })).toBeInTheDocument();
    expect(screen.getByText("Pinned pass")).toBeInTheDocument();
    expect(screen.getByText("Warning run")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Warnings" }));
    expect(screen.queryByText("Pinned pass")).not.toBeInTheDocument();
    expect(screen.getByText("Warning run")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All" }));

    await user.click(screen.getByRole("checkbox", { name: /Pinned pass/ }));
    await user.click(screen.getByRole("checkbox", { name: /Warning run/ }));
    expect(screen.getByText("Pinned pass ↔ Warning run")).toBeInTheDocument();
    expect(screen.getByText("+3 m")).toBeInTheDocument();

    const pinnedCard = screen.getByText("Pinned pass").closest("li")!;
    await user.click(within(pinnedCard).getByRole("button", { name: "Reopen" }));
    expect(onOpen).toHaveBeenCalledWith(RUNS[0]);
    expect(archive.touch).toHaveBeenCalledWith("run-a");
  });

  it("exposes pin, recoverable delete, export, and quota controls", async () => {
    const user = userEvent.setup();
    render(<RunHistory pendingRecord={null} onPendingResolved={() => {}} onClose={() => {}} onOpen={() => {}} onRerun={() => {}} />);
    await screen.findByRole("heading", { name: "Run history" });

    const warningCard = screen.getByText("Warning run").closest("li")!;
    await user.click(within(warningCard).getByRole("button", { name: "Pin" }));
    expect(archive.setPinned).toHaveBeenCalledWith("run-b", true);
    await user.click(within(warningCard).getByRole("button", { name: "Delete" }));
    expect(archive.remove).toHaveBeenCalledWith("run-b");

    const quota = screen.getByRole("spinbutton", { name: "Archive quota (MiB)" });
    await user.clear(quota);
    await user.type(quota, "64");
    await user.click(screen.getByRole("button", { name: "Apply quota" }));
    expect(archive.setQuota).toHaveBeenCalledWith(64 * 1024 * 1024, []);
  });
});
