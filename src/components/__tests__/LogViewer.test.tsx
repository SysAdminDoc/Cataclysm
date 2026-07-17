import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  persistCrashReport,
  pushExternalDiagnostic,
  readPersistedCrashReport,
} from "../../lib/diagnosticsLog";
import { LogViewer } from "../LogViewer";

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function restoreClipboard() {
  if (originalClipboard) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
}

describe("LogViewer", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    restoreClipboard();
  });

  it("keeps console interception safe for circular payloads", async () => {
    const user = userEvent.setup();
    render(<LogViewer open onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Clear" }));

    const circular: Record<string, unknown> = { label: "diag-circular-payload" };
    circular.self = circular;

    expect(() => {
      act(() => {
        console.info("diag-circular-test", circular);
      });
    }).not.toThrow();
    expect(await screen.findByText(/diag-circular-test/)).toBeInTheDocument();
    expect(screen.getByText(/\[Circular\]/)).toBeInTheDocument();
  });

  it("surfaces clipboard copy failures without changing the command label", async () => {
    const user = userEvent.setup();
    const clipboard = {
      writeText: vi.fn<() => Promise<void>>().mockRejectedValue(new Error("denied")),
    };
    Object.defineProperty(navigator, "clipboard", {
      value: clipboard,
      configurable: true,
    });
    render(<LogViewer open onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    act(() => {
      console.log("copy-failure-entry");
    });
    expect(await screen.findByText(/copy-failure-entry/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy log" }));

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed.");
    expect(screen.getByRole("button", { name: "Copy log" })).toBeInTheDocument();
  });

  it("renders Rust solver diagnostic events in the session log", async () => {
    const user = userEvent.setup();
    render(<LogViewer open onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Clear" }));

    act(() => {
      pushExternalDiagnostic({
        level: "warn",
        message: "[gpu] readback failed or produced non-finite field - aborting GPU step",
      });
    });

    expect(await screen.findByText(/readback failed/)).toBeInTheDocument();
    expect(screen.getByText("warn")).toBeInTheDocument();
  });

  it("follows new entries only while the reader is near the log tail", async () => {
    const user = userEvent.setup();
    const { container } = render(<LogViewer open onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    const list = container.querySelector<HTMLElement>(".log-viewer__list") as HTMLElement;
    let scrollHeight = 1_000;
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
    });

    list.scrollTop = 100;
    fireEvent.scroll(list);
    act(() => pushExternalDiagnostic({ level: "info", message: "preserve-reader-position" }));
    await screen.findByText("preserve-reader-position");
    expect(list.scrollTop).toBe(100);

    list.scrollTop = 790;
    fireEvent.scroll(list);
    scrollHeight = 1_200;
    act(() => pushExternalDiagnostic({ level: "info", message: "follow-reader-tail" }));
    await screen.findByText("follow-reader-tail");
    expect(list.scrollTop).toBe(1_200);
  });

  it("includes the active Earth providers and asset versions in the support bundle", async () => {
    const user = userEvent.setup();
    const clipboard = { writeText: vi.fn<(text: string) => Promise<void>>().mockResolvedValue() };
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    render(<LogViewer open onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Copy diagnostics" }));

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalled());
    const bundle = JSON.parse(clipboard.writeText.mock.calls[0][0] as string) as {
      earth_assets: { active: { imageryAssetId: string }; providers: unknown[]; assets: unknown[] };
    };
    expect(bundle.earth_assets.active.imageryAssetId).toBeTruthy();
    expect(bundle.earth_assets.providers).toHaveLength(7);
    expect(bundle.earth_assets.assets).toHaveLength(13);
    expect(JSON.stringify(bundle).toLowerCase()).not.toContain("cesium_token");
  });

  it("redacts credentials and paths from copied logs and support bundles", async () => {
    const user = userEvent.setup();
    const clipboard = { writeText: vi.fn<(text: string) => Promise<void>>().mockResolvedValue() };
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    persistCrashReport({
      source: "window-error",
      name: "Error",
      message: "crash at C:\\Users\\private\\app.ts?token=crash-secret",
    });
    render(<LogViewer open onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    act(() => {
      pushExternalDiagnostic({
        level: "error",
        message: "Bearer abcdefghijklmnop123456 at \\\\server\\private\\file.log?access_token=query-secret",
      });
    });

    await user.click(screen.getByRole("button", { name: "Copy log" }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledTimes(2));

    for (const [copied] of clipboard.writeText.mock.calls) {
      expect(copied).not.toContain("abcdefghijklmnop123456");
      expect(copied).not.toContain("query-secret");
      expect(copied).not.toContain("crash-secret");
      expect(copied).not.toContain("C:\\Users\\private");
      expect(copied).not.toContain("\\\\server\\private");
    }
  });

  it("marks an unseen crash reviewed only when diagnostics opens", async () => {
    const user = userEvent.setup();
    persistCrashReport({ source: "unhandled-rejection", name: "Error", message: "inspect me" });
    expect(readPersistedCrashReport()?.seen).toBe(false);

    render(<LogViewer open={false} onClose={() => {}} />);
    expect(readPersistedCrashReport()?.seen).toBe(false);

    render(<LogViewer open onClose={() => {}} />);
    expect(await screen.findByRole("region", { name: "Previous crash report" })).toHaveTextContent("inspect me");
    expect(readPersistedCrashReport()?.seen).toBe(true);
    await user.click(screen.getByRole("button", { name: "Clear report" }));
    expect(readPersistedCrashReport()).toBeNull();
  });
});
