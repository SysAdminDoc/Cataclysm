import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttenuationChart } from "../AttenuationChart";
import type { InitialDisplacement } from "../../types/scenario";

const tauriApi = vi.hoisted(() => ({ attenuationCurve: vi.fn() }));

vi.mock("../../lib/tauri", () => ({
  api: tauriApi,
  isTauri: () => true,
}));

const INITIAL: InitialDisplacement = {
  center: { lat_deg: 21.4, lon_deg: -89.5, depth_m: 1500 },
  cavity_radius_m: 50_000,
  peak_amplitude_m: 4500,
  source_energy_j: 1e25,
  seismic_mw_equivalent: 10.5,
  label: "Chicxulub",
};

const CURVE = [
  { range_m: 1_000, amplitude_m: 10 },
  { range_m: 10_000_000, amplitude_m: 0.1 },
];

describe("AttenuationChart async state", () => {
  beforeEach(() => tauriApi.attenuationCurve.mockReset());

  it("shows first-load failure and retries locally", async () => {
    tauriApi.attenuationCurve
      .mockRejectedValueOnce(new Error("solver unavailable"))
      .mockResolvedValueOnce(CURVE);
    const user = userEvent.setup();
    render(<AttenuationChart initial={INITIAL} isImpact timeS={0} runupResults={[]} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't compute wave attenuation");
    await user.click(screen.getByRole("button", { name: "Retry attenuation" }));
    expect(await screen.findByRole("img", { name: /modeled wave amplitude decay/i })).toBeInTheDocument();
  });

  it("keeps the last valid curve and marks it stale after a refresh failure", async () => {
    tauriApi.attenuationCurve
      .mockResolvedValueOnce(CURVE)
      .mockRejectedValueOnce(new Error("refresh failed"));
    const { rerender } = render(
      <AttenuationChart initial={INITIAL} isImpact timeS={0} runupResults={[]} />,
    );
    await screen.findByRole("img", { name: /modeled wave amplitude decay/i });

    rerender(<AttenuationChart initial={{ ...INITIAL }} isImpact timeS={0} runupResults={[]} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/last valid attenuation curve: refresh failed/));
    expect(screen.getByRole("img", { name: /modeled wave amplitude decay/i })).toBeInTheDocument();
  });
});
