import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SemanticDataTable } from "../SemanticDataTable";
import { I18nProvider } from "../../lib/i18n";

describe("SemanticDataTable", () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies injection-safe CSV and downloads the same disclosure data", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:semantic-table");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(
      <SemanticDataTable
        id="chart"
        title="test chart"
        summary="A concise summary."
        columns={[{ key: "series", label: "Series" }, { key: "value", label: "Value", dataType: "number" }]}
        rows={[{ series: "=unsafe formula", value: -1.25 }]}
        filename="test-chart.csv"
      />,
    );

    await user.click(screen.getByText("View test chart data (1 row)"));
    await user.click(screen.getByRole("button", { name: "Copy test chart CSV" }));
    expect(writeText).toHaveBeenCalledWith(
      '"Series","Value"\r\n"\'=unsafe formula",-1.25',
    );
    expect(await screen.findByRole("status")).toHaveTextContent("CSV copied.");

    await user.click(screen.getByRole("button", { name: "Export test chart CSV" }));
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
  });

  it("localizes table disclosure and CSV actions in Japanese", async () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <SemanticDataTable
          id="chart-ja"
          title="波高"
          summary="沿岸波高の要約。"
          columns={[{ key: "series", label: "系列" }]}
          rows={[{ series: "観測" }, { series: "モデル" }]}
          filename="wave-height.csv"
        />
      </I18nProvider>,
    );
    await user.click(screen.getByText("波高のデータを表示（2行）"));
    expect(screen.getByRole("button", { name: "波高のCSVをコピー" })).toHaveTextContent("CSVをコピー");
    expect(screen.getByRole("button", { name: "波高のCSVを書き出す" })).toHaveTextContent("CSVを書き出す");
    expect(screen.getByRole("region", { name: "波高のデータ表" })).toBeInTheDocument();
  });
});
