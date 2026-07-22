import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "../Settings";
import { I18nProvider } from "../../lib/i18n";

describe("Settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders no-token and offline-friendly globe rows", async () => {
    const user = userEvent.setup();
    render(<Settings onClose={() => {}} />);

    expect(await screen.findByText("Earth rendering")).toBeInTheDocument();
    expect(screen.getByText(/bundled and works offline/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "OpenStreetMap (no token)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Natural Earth II (offline-friendly)" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Simulation performance" }));
    expect(screen.getByText(/Desktop build only/i)).toBeInTheDocument();
  });

  it("renders the config-derived network disclosure without contacting providers", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(window, "fetch");
    render(<Settings onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: "Data & network" }));
    expect(screen.getByRole("heading", { name: "Data & Network trust" })).toBeInTheDocument();
    expect(screen.getByText("No telemetry", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("No device location transmitted", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("https://earthquake.usgs.gov")).toBeInTheDocument();
    expect(screen.getByText("https://ssd-api.jpl.nasa.gov")).toBeInTheDocument();
    expect(screen.getByText("https://www.ngdc.noaa.gov")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("renders the complete settings chrome in the persisted locale", async () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    render(<I18nProvider><Settings onClose={() => {}} /></I18nProvider>);

    expect(await screen.findByRole("heading", { name: "設定" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "地球表示と外観" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "地球表示" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Natural Earth II（オフライン）" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "変更を適用" })).toBeInTheDocument();
  });

  it("uses roving focus and arrow keys for renderer quality radios", async () => {
    const user = userEvent.setup();
    render(<Settings onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: "Simulation performance" }));
    const high = screen.getByRole("radio", { name: /^High/ });
    const cinematic = screen.getByRole("radio", { name: /^Cinematic/ });
    const low = screen.getByRole("radio", { name: /^Low/ });
    expect(high).toHaveAttribute("aria-checked", "true");
    expect(high).toHaveAttribute("tabindex", "0");
    expect(cinematic).toHaveAttribute("tabindex", "-1");

    high.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(cinematic);
    expect(cinematic).toHaveAttribute("aria-checked", "true");
    expect(high).toHaveAttribute("tabindex", "-1");

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(low);
    expect(low).toHaveAttribute("aria-checked", "true");
  });

  it("saves a trimmed token and dispatches settings updates", async () => {
    const saved = vi.fn();
    window.addEventListener("tsunamisim:settings-saved", saved);
    const user = userEvent.setup();
    render(<Settings onClose={() => {}} />);

    const token = await screen.findByPlaceholderText(/Paste token/i);
    expect(screen.getByRole("button", { name: "Apply Changes" })).toBeDisabled();
    await user.type(token, "  abc123  ");
    await user.click(screen.getByRole("button", { name: "Catppuccin Latte (light)" }));
    await user.click(screen.getByRole("button", { name: "Cividis (CVD-safe)" }));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply Changes" }));

    expect(await screen.findByText(/Changes applied at/i)).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("tsunamisim.cesium_token") ?? "\"\"")).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("tsunamisim.theme") ?? "\"\"")).toBe("latte");
    expect(JSON.parse(localStorage.getItem("tsunamisim.colormap") ?? "\"\"")).toBe("cividis");
    expect(saved).toHaveBeenCalled();
    window.removeEventListener("tsunamisim:settings-saved", saved);
  });

  it("persists the selected interface language", async () => {
    const saved = vi.fn();
    window.addEventListener("tsunamisim:settings-saved", saved);
    const user = userEvent.setup();
    render(<Settings onClose={() => {}} />);

    const language = await screen.findByRole("combobox", { name: "Interface language" });
    await user.selectOptions(language, "ja");
    await user.click(screen.getByRole("button", { name: "Apply Changes" }));

    expect(JSON.parse(localStorage.getItem("tsunamisim.locale") ?? '""')).toBe("ja");
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

    await user.click(await screen.findByRole("button", { name: "Data & onboarding" }));
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

    await user.click(await screen.findByRole("button", { name: "Data & onboarding" }));
    await user.click(await screen.findByRole("button", { name: "Show online-map notice again" }));

    expect(await screen.findByText("The online-map notice will appear again.")).toBeInTheDocument();
    expect(localStorage.getItem("tsunamisim.token_banner_dismissed_at")).toBeNull();
    expect(saved).toHaveBeenCalled();
    window.removeEventListener("tsunamisim:settings-saved", saved);
  });

  it("offers a retry when the settings download API fails", async () => {
    const user = userEvent.setup();
    const createUrl = vi.spyOn(URL, "createObjectURL")
      .mockImplementationOnce(() => { throw new Error("downloads denied"); })
      .mockReturnValue("blob:settings-retry");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      render(<Settings onClose={() => {}} />);
      await user.click(await screen.findByRole("button", { name: "Data & onboarding" }));
      await user.click(screen.getByRole("button", { name: "Export settings" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Download failed: Blob download failed");
      await user.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByText("Settings exported.")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(createUrl).toHaveBeenCalledTimes(2);
      expect(revokeUrl).toHaveBeenCalledWith("blob:settings-retry");
    } finally {
      createUrl.mockRestore();
      revokeUrl.mockRestore();
      click.mockRestore();
    }
  });

  it("does not silently discard staged changes from a backdrop click", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<Settings onClose={onClose} />);

    const token = await screen.findByPlaceholderText(/Paste token/i);
    await user.type(token, "staged-token");
    await user.click(container.querySelector(".modal-overlay") as HTMLElement);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved changes remain. Apply them or choose Cancel.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
