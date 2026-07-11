import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pushExternalDiagnostic } from "../../lib/diagnosticsLog";
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
    expect(bundle.earth_assets.assets).toHaveLength(11);
    expect(JSON.stringify(bundle).toLowerCase()).not.toContain("cesium_token");
  });
});
