import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MIRVPatternPanel } from "../MIRVPatternPanel";

describe("MIRVPatternPanel", () => {
  it("selects a preserved preset and publishes a globe preview", async () => {
    const user = userEvent.setup();
    const onPreviewChange = vi.fn();
    render(
      <MIRVPatternPanel
        center={{ lat: 40, lon: -74 }}
        preview={null}
        onPreviewChange={onPreviewChange}
        onApplyYield={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Payload preset" }).querySelectorAll("option")).toHaveLength(9);
    await user.selectOptions(screen.getByRole("combobox", { name: "Payload preset" }), "trident-ii-w76");
    const published = onPreviewChange.mock.calls.findLast((call) => call[0] !== null)?.[0];
    expect(published.points).toHaveLength(8);
    expect(published.preset.yieldKt).toBe(100);
  });

  it("requires an effects origin before publishing a pattern", async () => {
    const user = userEvent.setup();
    const onPreviewChange = vi.fn();
    render(
      <MIRVPatternPanel center={null} preview={null} onPreviewChange={onPreviewChange} onApplyYield={vi.fn()} />,
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Payload preset" }), "minuteman-iii");
    expect(screen.getByRole("status")).toHaveTextContent("Choose an effects origin");
    expect(onPreviewChange).not.toHaveBeenCalledWith(expect.objectContaining({ preset: expect.anything() }));
  });
});
