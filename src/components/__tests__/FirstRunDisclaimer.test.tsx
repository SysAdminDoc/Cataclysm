import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FirstRunDisclaimer, REPLAY_DISCLAIMER_EVENT } from "../FirstRunDisclaimer";
import { LAUNCH_COMPLETE_EVENT } from "../LaunchExperience";
import { settings } from "../../lib/settings";
import { I18nProvider } from "../../lib/i18n";

describe("FirstRunDisclaimer", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.launchExperienceActive;
  });

  it("persists acknowledgement and notifies the app to continue onboarding", async () => {
    const acknowledged = vi.fn();
    window.addEventListener("tsunamisim:disclaimer-acknowledged", acknowledged);
    const user = userEvent.setup();

    render(<FirstRunDisclaimer />);

    await user.click(await screen.findByRole("button", { name: "I understand" }));

    await waitFor(() => {
      expect(localStorage.getItem("tsunamisim.disclaimer_acknowledged_at")).not.toBeNull();
      expect(acknowledged).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    window.removeEventListener("tsunamisim:disclaimer-acknowledged", acknowledged);
  });

  it("frames every hazard output as a model estimate", async () => {
    render(<FirstRunDisclaimer />);

    expect(await screen.findByText(/planetary-hazard source physics/i)).toBeInTheDocument();
    expect(screen.getByText(/not observations, forecasts, or official warnings/i)).toBeInTheDocument();
    expect(screen.getByText(/idealized source physics/i)).toBeInTheDocument();
  });

  it("reopens immediately on a replay event even after acknowledgement", async () => {
    // Already acknowledged: the modal must not auto-open...
    await settings.acknowledgeDisclaimer();
    render(<FirstRunDisclaimer />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // ...but a replay request opens it right away.
    window.dispatchEvent(new CustomEvent(REPLAY_DISCLAIMER_EVENT));
    expect(await screen.findByRole("dialog", { name: /educational model/i })).toBeInTheDocument();
  });

  it("waits for the launch cinematic before showing first-run safety guidance", async () => {
    document.documentElement.dataset.launchExperienceActive = "true";
    render(<FirstRunDisclaimer />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    window.dispatchEvent(new CustomEvent(LAUNCH_COMPLETE_EVENT));

    expect(await screen.findByRole("dialog", { name: /educational model/i })).toBeInTheDocument();
  });

  it("fails safe when the acknowledgement setting cannot be read", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(settings, "getDisclaimerAcknowledged").mockRejectedValueOnce(
      new Error("settings unavailable"),
    );

    render(<FirstRunDisclaimer />);

    expect(await screen.findByRole("dialog", { name: /educational model/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/cannot confirm or save/i);
    expect(warning).toHaveBeenCalledWith(
      "[disclaimer] could not read acknowledgement",
      expect.any(Error),
    );

    warning.mockRestore();
  });

  it("continues the current session when acknowledgement cannot be persisted", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(settings, "acknowledgeDisclaimer").mockRejectedValueOnce(
      new Error("settings unavailable"),
    );
    const acknowledged = vi.fn();
    window.addEventListener("tsunamisim:disclaimer-acknowledged", acknowledged);
    const user = userEvent.setup();

    render(<FirstRunDisclaimer />);
    await user.click(await screen.findByRole("button", { name: "I understand" }));

    await waitFor(() => expect(acknowledged).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(warning).toHaveBeenCalledWith(
      "[disclaimer] could not persist acknowledgement",
      expect.any(Error),
    );

    window.removeEventListener("tsunamisim:disclaimer-acknowledged", acknowledged);
    warning.mockRestore();
  });

  it("localizes first-run safety guidance in Japanese", async () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    render(<I18nProvider><FirstRunDisclaimer /></I18nProvider>);

    expect(await screen.findByRole("dialog", { name: "教育用モデルであり、警報システムではありません" })).toBeInTheDocument();
    expect(screen.getByText("適した用途")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "理解しました" })).toBeInTheDocument();
  });
});
