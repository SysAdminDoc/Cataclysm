import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  markCrashReportSeen,
  persistCrashReport,
  readPersistedCrashReport,
} from "../../lib/diagnosticsLog";
import { CrashRecoveryNotice } from "../CrashRecoveryNotice";
import { I18nProvider } from "../../lib/i18n";

describe("CrashRecoveryNotice", () => {
  beforeEach(() => localStorage.clear());

  it("offers an unseen prior report without marking it reviewed", () => {
    persistCrashReport({ source: "window-error", name: "Error", message: "previous failure" });
    render(<CrashRecoveryNotice onInspect={() => {}} />);

    expect(screen.getByText(/previous failure is available/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inspect report" })).toBeInTheDocument();
    expect(readPersistedCrashReport()?.seen).toBe(false);
  });

  it("opens diagnostics while leaving review state to the viewer", async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    persistCrashReport({ source: "unhandled-rejection", name: "Error", message: "promise failed" });
    render(<CrashRecoveryNotice onInspect={onInspect} />);

    await user.click(screen.getByRole("button", { name: "Inspect report" }));
    expect(onInspect).toHaveBeenCalledOnce();
    expect(readPersistedCrashReport()?.seen).toBe(false);
  });

  it("disappears after explicit inspection or clearing", async () => {
    const user = userEvent.setup();
    persistCrashReport({ name: "Error", message: "review me" });
    render(<CrashRecoveryNotice onInspect={() => {}} />);

    act(() => markCrashReportSeen());
    expect(screen.queryByText(/previous failure is available/i)).not.toBeInTheDocument();

    act(() => persistCrashReport({ name: "Error", message: "clear me" }));
    await user.click(screen.getByRole("button", { name: "Clear report" }));
    expect(readPersistedCrashReport()).toBeNull();
    expect(screen.queryByText(/previous failure is available/i)).not.toBeInTheDocument();
  });

  it("localizes recovery actions in Japanese", () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    persistCrashReport({ source: "window-error", name: "Error", message: "previous failure" });
    render(<I18nProvider><CrashRecoveryNotice onInspect={() => {}} /></I18nProvider>);
    expect(screen.getByText("前回の障害レポートを確認できます。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "レポートを確認" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "レポートを消去" })).toBeInTheDocument();
  });
});
