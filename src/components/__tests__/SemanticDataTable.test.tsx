import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SemanticDataTable } from "../SemanticDataTable";

describe("SemanticDataTable", () => {
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
        columns={[{ key: "series", label: "Series" }, { key: "value", label: "Value" }]}
        rows={[{ series: "=unsafe formula", value: 1.25 }]}
        filename="test-chart.csv"
      />,
    );

    await user.click(screen.getByText("View test chart data (1 rows)"));
    await user.click(screen.getByRole("button", { name: "Copy test chart CSV" }));
    expect(writeText).toHaveBeenCalledWith(
      '"Series","Value"\r\n"\'=unsafe formula","1.25"',
    );
    expect(await screen.findByRole("status")).toHaveTextContent("CSV copied.");

    await user.click(screen.getByRole("button", { name: "Export test chart CSV" }));
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
  });
});
