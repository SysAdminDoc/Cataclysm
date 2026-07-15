import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../ErrorBoundary";
import { readPersistedCrashReport } from "../../lib/diagnosticsLog";
import { settings } from "../../lib/settings";

function ThrowingChild(): null {
  throw new Error("Boundary test failure");
}

describe("ErrorBoundary", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <div>Healthy app</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText("Healthy app")).toBeInTheDocument();
  });

  it("shows a recovery panel and logs render errors", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByText(/Boundary test failure/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload app" })).toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("persists a crash report and offers recovery actions", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    // Recovery actions are all present.
    expect(screen.getByRole("button", { name: "Reset visual settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save diagnostics" })).toBeInTheDocument();

    // A redacted report survives in storage for review after a reload.
    const report = readPersistedCrashReport();
    expect(report).not.toBeNull();
    expect(report?.message).toContain("Boundary test failure");
    expect(report?.seen).toBe(false);
  });

  it("explains unavailable clipboard access instead of failing silently", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    render(<ErrorBoundary><ThrowingChild /></ErrorBoundary>);

    await user.click(screen.getByRole("button", { name: "Copy diagnostics" }));

    expect(screen.getByRole("status")).toHaveTextContent(/Clipboard access is unavailable/);
  });

  it("reports a persistent visual-reset failure without reloading", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(settings, "resetVisualSettings").mockRejectedValue(new Error("desktop store unavailable"));
    const user = userEvent.setup();
    render(<ErrorBoundary><ThrowingChild /></ErrorBoundary>);

    await user.click(screen.getByRole("button", { name: "Reset visual settings" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/desktop store unavailable/);
  });
});
