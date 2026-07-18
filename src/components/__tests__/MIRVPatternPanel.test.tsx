import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MIRVPatternPanel } from "../MIRVPatternPanel";
import { buildMirvPreview, MIRV_PRESETS } from "../../lib/mirv";
import { I18nProvider } from "../../lib/i18n";

describe("MIRVPatternPanel", () => {
  beforeEach(() => localStorage.clear());

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

  it("localizes MIRV controls, pattern metadata, and aim-point semantics in Japanese", () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    const center = { lat: 40, lon: -74 };
    const preview = buildMirvPreview(center, MIRV_PRESETS[0]);
    render(
      <I18nProvider>
        <MIRVPatternPanel center={center} preview={preview} onPreviewChange={() => {}} onApplyYield={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByText("MIRVパターンプレビュー")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "搭載量プリセット" })).toBeInTheDocument();
    expect(screen.getByText("弾頭あたり")).toBeInTheDocument();
    expect(screen.getByText("円形")).toBeInTheDocument();
    expect(screen.getByText("アクセス可能な照準点一覧")).toBeInTheDocument();
  });
});
