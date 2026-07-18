import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LaunchExperience, LAUNCH_COMPLETE_EVENT } from "../LaunchExperience";
import { I18nProvider } from "../../lib/i18n";

describe("LaunchExperience", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.launchExperienceActive;
    vi.restoreAllMocks();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  });

  it("shows immediately on a true first launch and can be skipped", async () => {
    const completed = vi.fn();
    window.addEventListener(LAUNCH_COMPLETE_EVENT, completed);
    render(<LaunchExperience durationMs={60_000} />);
    expect(screen.getByRole("dialog", { name: "Cataclysm" })).toBeInTheDocument();
    expect(document.documentElement.dataset.launchExperienceActive).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Skip intro" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Cataclysm" })).not.toBeInTheDocument());
    expect(localStorage.getItem("tsunamisim.launch_experience_seen_at")).not.toBeNull();
    expect(completed).toHaveBeenCalled();
    window.removeEventListener(LAUNCH_COMPLETE_EVENT, completed);
  });

  it("treats a non-control click as an immediate skip", async () => {
    render(<LaunchExperience durationMs={60_000} />);
    fireEvent.pointerDown(screen.getByRole("dialog", { name: "Cataclysm" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Cataclysm" })).not.toBeInTheDocument());
  });

  it("does not replay first-launch mode for an existing acknowledged user", async () => {
    localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", JSON.stringify("2026-01-01T00:00:00.000Z"));
    render(<LaunchExperience />);
    expect(screen.queryByRole("dialog", { name: "Cataclysm" })).not.toBeInTheDocument();
  });

  it("supports deterministic launch-preview capture without changing stored preferences", () => {
    window.history.replaceState({}, "", "/?launchExperience=1");
    localStorage.setItem("tsunamisim.launch_experience_policy", JSON.stringify("never"));
    render(<LaunchExperience durationMs={60_000} />);
    expect(screen.getByRole("dialog", { name: "Cataclysm" })).toBeInTheDocument();
    window.history.replaceState({}, "", "/");
  });

  it("uses the short static path when reduced motion is requested", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    render(<LaunchExperience durationMs={60_000} />);
    expect(screen.getByRole("dialog", { name: "Cataclysm" })).toHaveAttribute("data-reduced-motion", "true");
  });

  it("localizes the launch identity and controls in Japanese", () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    render(<I18nProvider><LaunchExperience durationMs={60_000} /></I18nProvider>);
    expect(screen.getByText("惑星災害シミュレーター")).toBeInTheDocument();
    expect(screen.getByText("生きた地球を準備中")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "イントロをスキップ" })).toBeInTheDocument();
  });
});
