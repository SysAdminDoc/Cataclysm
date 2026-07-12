import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FirstRunDisclaimer } from "../FirstRunDisclaimer";
import { LAUNCH_COMPLETE_EVENT } from "../LaunchExperience";

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

  it("waits for the launch cinematic before showing first-run safety guidance", async () => {
    document.documentElement.dataset.launchExperienceActive = "true";
    render(<FirstRunDisclaimer />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    window.dispatchEvent(new CustomEvent(LAUNCH_COMPLETE_EVENT));

    expect(await screen.findByRole("dialog", { name: /educational model/i })).toBeInTheDocument();
  });
});
