import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

    await user.click(screen.getByRole("button", { name: "Copy to clipboard" }));

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed.");
    expect(screen.getByRole("button", { name: "Copy to clipboard" })).toBeInTheDocument();
  });
});
