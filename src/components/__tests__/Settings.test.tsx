import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "../Settings";

describe("Settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders no-token and offline-friendly globe rows", async () => {
    render(<Settings onClose={() => {}} />);

    expect(await screen.findByText("Globe imagery")).toBeInTheDocument();
    expect(screen.getByText(/works out of the box/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "OpenStreetMap (no token)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Natural Earth II (offline-friendly)" })).toBeInTheDocument();
    expect(screen.getByText(/Checking hardware/i)).toBeInTheDocument();
  });

  it("saves a trimmed token and dispatches settings updates", async () => {
    const saved = vi.fn();
    window.addEventListener("tsunamisim:settings-saved", saved);
    const user = userEvent.setup();
    render(<Settings onClose={() => {}} />);

    const token = await screen.findByPlaceholderText(/Paste your token here/i);
    await user.type(token, "  abc123  ");
    await user.click(screen.getByRole("button", { name: "Catppuccin Latte (light)" }));
    await user.click(screen.getByRole("button", { name: "Cividis (CVD-safe)" }));
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/Saved at/i)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("tsunamisim.cesium_token") ?? "\"\"")).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("tsunamisim.theme") ?? "\"\"")).toBe("latte");
    expect(JSON.parse(localStorage.getItem("tsunamisim.colormap") ?? "\"\"")).toBe("cividis");
    expect(saved).toHaveBeenCalled();
    window.removeEventListener("tsunamisim:settings-saved", saved);
  });

  it("resets persisted settings to defaults", async () => {
    localStorage.setItem("tsunamisim.cesium_token", JSON.stringify("secret"));
    localStorage.setItem("tsunamisim.theme", JSON.stringify("latte"));
    localStorage.setItem("tsunamisim.globe_style", JSON.stringify("cesium-world-imagery"));
    localStorage.setItem("tsunamisim.colormap", JSON.stringify("cividis"));
    const user = userEvent.setup();
    render(<Settings onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: "Reset to defaults" }));

    expect(await screen.findByText("Settings reset to defaults.")).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("tsunamisim.cesium_token")).toBeNull());
    expect(localStorage.getItem("tsunamisim.theme")).toBeNull();
    expect(localStorage.getItem("tsunamisim.globe_style")).toBeNull();
    expect(localStorage.getItem("tsunamisim.colormap")).toBeNull();
  });

  it("re-arms the imagery token banner", async () => {
    localStorage.setItem("tsunamisim.token_banner_dismissed_at", JSON.stringify("2026-06-17T00:00:00.000Z"));
    const saved = vi.fn();
    window.addEventListener("tsunamisim:settings-saved", saved);
    const user = userEvent.setup();
    render(<Settings onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: "Show token banner again" }));

    expect(await screen.findByText("Imagery token banner re-armed.")).toBeInTheDocument();
    expect(localStorage.getItem("tsunamisim.token_banner_dismissed_at")).toBeNull();
    expect(saved).toHaveBeenCalled();
    window.removeEventListener("tsunamisim:settings-saved", saved);
  });
});
