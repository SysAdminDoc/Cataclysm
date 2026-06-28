import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Preset } from "../../types/scenario";
import { CitationsModal } from "../CitationsModal";

function citationPreset(overrides: Partial<Preset>): Preset {
  return {
    blurb: "Reference test preset",
    date: "2026",
    id: "reference-test",
    name: "Reference Test",
    reference: "Reference Test Paper",
    source: {
      kind: "Asteroid",
      source: {
        angle_deg: 45,
        density_kg_m3: 3000,
        diameter_m: 1000,
        location: { depth_m: 4000, lat_deg: 0, lon_deg: 0 },
        velocity_m_s: 20_000,
        water_depth_m: 4000,
      },
    },
    ...overrides,
  };
}

describe("CitationsModal", () => {
  it("marks documented HTTP exceptions and blocks unvetted citation URLs with an alert", async () => {
    const user = userEvent.setup();
    render(
      <CitationsModal
        onClose={() => {}}
        presets={[
          citationPreset({
            id: "legacy",
            reference: "Legacy Tsunami Society PDF",
            reference_url: "http://www.tsunamisociety.org/213choi.pdf",
          }),
          citationPreset({
            id: "blocked",
            reference: "Unreviewed Publisher Landing Page",
            reference_url: "https://www.science.org/",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Legacy HTTP")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Unreviewed Publisher Landing Page/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/Blocked citation link/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/not in the allowlist/i);
  });
});
