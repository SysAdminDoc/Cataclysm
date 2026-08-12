import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HazelValidationPanel } from "../HazelValidationPanel";
import { I18nProvider } from "../../lib/i18n";
import type { HazelRunupSearchResponse } from "../../lib/ncei-hazel";

const response: HazelRunupSearchResponse = {
  items: [{ id: 1, latitude: 1, longitude: 2, runupHt: 1 }],
  page: 1,
  totalPages: 1,
  itemsPerPage: 100,
  totalItems: 10,
  sampledItems: 10,
  truncated: false,
};

const summary = {
  sourceItemCount: 10,
  fetchedItemCount: 10,
  validObservedCount: 8,
  plottedCount: 8,
  matchedCount: 3,
  matchRadiusM: 50_000,
  biasM: -1.25,
  rmseM: 2.5,
  meanAbsoluteErrorM: 2,
  observedMaxM: 8,
  modeledMaxM: 6,
  sourceTruncated: false,
  displaySampled: false,
};

describe("HazelValidationPanel", () => {
  it("reports residual metrics and keeps the source caveat visible", () => {
    render(
      <I18nProvider>
        <HazelValidationPanel
          eventId={1902}
          result={{ status: "ready", value: response }}
          summary={summary}
          desktopAvailable
          online
          onRetry={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("HazEL observed runup comparison")).toBeInTheDocument();
    expect(screen.getByText("Mean residual").parentElement).toHaveTextContent("-1.25 m");
    expect(screen.getByText(/Screening comparison only/)).toBeInTheDocument();
  });

  it("degrades to a browser/offline explanation with a retry action", () => {
    const onRetry = vi.fn();
    render(
      <I18nProvider>
        <HazelValidationPanel
          eventId={1902}
          result={{ status: "error", error: "offline" }}
          summary={null}
          desktopAvailable={false}
          online
          onRetry={onRetry}
        />
      </I18nProvider>,
    );

    expect(screen.getByText(/browser preview is network-isolated/i)).toBeInTheDocument();
    screen.getByRole("button", { name: "Retry HazEL lookup" }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
