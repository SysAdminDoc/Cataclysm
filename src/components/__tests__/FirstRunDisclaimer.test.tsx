import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FirstRunDisclaimer } from "../FirstRunDisclaimer";

describe("FirstRunDisclaimer", () => {
  beforeEach(() => {
    localStorage.clear();
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
});
