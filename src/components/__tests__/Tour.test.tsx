import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Tour } from "../Tour";
import { I18nProvider } from "../../lib/i18n";

describe("Tour", () => {
  beforeEach(() => localStorage.clear());

  it("describes the current solver and closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Tour open onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/60-frame shallow-water simulation/i)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("localizes tour steps and navigation in Japanese", async () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    const user = userEvent.setup();
    render(<I18nProvider><Tour open onClose={() => {}} /></I18nProvider>);
    expect(screen.getByRole("dialog", { name: "Cataclysmへようこそ" })).toBeInTheDocument();
    expect(screen.getByText("6ステップ中1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("heading", { name: "1 · 歴史的イベントを選ぶ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "戻る" })).toBeEnabled();
  });
});
