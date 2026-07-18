import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NeoSearch } from "../NeoSearch";
import { I18nProvider } from "../../lib/i18n";

describe("NeoSearch", () => {
  beforeEach(() => localStorage.clear());

  it("applies a bundled reference object when live lookup is unavailable", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<NeoSearch onSelect={onSelect} />);

    await user.type(screen.getByRole("searchbox", { name: "NASA NEO lookup" }), "Apophis");
    await user.click(screen.getByRole("button", { name: "Search" }));
    const result = await screen.findByRole("button", { name: /Apophis.*Apply as impact inputs/i });
    expect(result).toHaveTextContent("Built-in fallback");
    await user.click(result);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ diameterM: 340, densityKgM3: 3_300 }));
  });

  it("reports when an unknown object needs the desktop live service", async () => {
    const user = userEvent.setup();
    render(<NeoSearch onSelect={() => {}} />);
    await user.type(screen.getByRole("searchbox", { name: "NASA NEO lookup" }), "unknown object");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/desktop app/i);
  });

  it("localizes lookup controls and known service errors", async () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    const user = userEvent.setup();
    render(<I18nProvider><NeoSearch onSelect={() => {}} /></I18nProvider>);
    await user.type(screen.getByRole("searchbox", { name: "NASA NEO検索" }), "unknown object");
    await user.click(screen.getByRole("button", { name: "検索" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("デスクトップアプリ");
  });
});
