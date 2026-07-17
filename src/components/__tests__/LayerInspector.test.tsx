import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LayerInspector } from "../LayerInspector";

describe("LayerInspector trust evidence", () => {
  it("provides a contextual evidence disclosure for every analytical layer", async () => {
    const user = userEvent.setup();
    render(
      <LayerInspector
        domain="tsunami"
        hasSource
        hasWavefront
        hasSweField
        hasMaxField
        arrivalCount={3}
        runupCount={2}
        dartCount={1}
        hasFallout={false}
        onOpenSettings={vi.fn()}
      />,
    );

    const disclosures = screen.getAllByText("Why trust this?");
    expect(disclosures).toHaveLength(7);
    await user.click(disclosures[2]);
    expect(screen.getByText("Finite-volume shallow-water-equation solver")).toBeInTheDocument();
    expect(screen.getByText("layer:custom:scenario:swe-field")).toBeInTheDocument();
  });

  it("shows each inactive layer state once without duplicating Waiting in evidence", () => {
    render(
      <LayerInspector
        domain="tsunami"
        hasSource={false}
        hasWavefront={false}
        hasSweField={false}
        hasMaxField={false}
        arrivalCount={0}
        runupCount={0}
        dartCount={0}
        hasFallout={false}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Waiting")).toHaveLength(7);
    expect(screen.getAllByText("Evidence")).toHaveLength(7);
  });
});
