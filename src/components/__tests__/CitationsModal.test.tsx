import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Preset } from "../../types/scenario";
import { CitationsModal } from "../CitationsModal";
import { I18nProvider } from "../../lib/i18n";

const tauriMocks = vi.hoisted(() => ({
  thirdPartyNotices: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  api: { thirdPartyNotices: tauriMocks.thirdPartyNotices },
  isTauri: () => true,
}));

function citationPreset(overrides: Partial<Preset>): Preset {
  return {
    blurb: "Reference test preset",
    date: "2026",
    id: "reference-test",
    name: "Reference Test",
    reference: "Reference Test Paper",
    source: {
      kind: "Asteroid",
      source: {
        angle_deg: 45,
        density_kg_m3: 3000,
        diameter_m: 1000,
        location: { depth_m: 4000, lat_deg: 0, lon_deg: 0 },
        velocity_m_s: 20_000,
        water_depth_m: 4000,
      },
    },
    ...overrides,
  };
}

describe("CitationsModal", () => {
  beforeEach(() => {
    localStorage.clear();
    tauriMocks.thirdPartyNotices.mockReset();
    tauriMocks.thirdPartyNotices.mockResolvedValue(
      "CATACLYSM THIRD-PARTY NOTICES\n\nProduction components: 36 npm; 279 Rust",
    );
  });

  it("marks documented HTTP exceptions and blocks unvetted citation URLs with an alert", async () => {
    const user = userEvent.setup();
    render(
      <CitationsModal
        onClose={() => {}}
        presets={[
          citationPreset({
            id: "legacy",
            reference: "Legacy Tsunami Society PDF",
            reference_url: "http://www.tsunamisociety.org/213choi.pdf",
          }),
          citationPreset({
            id: "blocked",
            reference: "Unreviewed Publisher Landing Page",
            reference_url: "https://www.science.org/",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Legacy HTTP")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Unreviewed Publisher Landing Page/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/Blocked citation link/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/not in the allowlist/i);
  });

  it("reads the installed notice artifact without opening an external application", async () => {
    const user = userEvent.setup();
    render(<CitationsModal onClose={() => {}} presets={[citationPreset({})]} />);

    await user.click(screen.getByRole("button", { name: "View third-party notices" }));

    expect(await screen.findByRole("heading", { name: "Third-party dependency notices" })).toBeInTheDocument();
    expect(screen.getByText(/CATACLYSM THIRD-PARTY NOTICES/)).toHaveTextContent(
      /Production components: 36 npm; 279 Rust/,
    );
    expect(tauriMocks.thirdPartyNotices).toHaveBeenCalledOnce();
  });

  it("localizes reference controls and blocked-link diagnostics in Japanese", async () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <CitationsModal
          onClose={() => {}}
          presets={[citationPreset({
            is_speculative: true,
            reference: "Unreviewed Publisher Landing Page",
            reference_url: "https://www.science.org/",
          })]}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("heading", { name: "詳細な参考文献と来歴" })).toBeInTheDocument();
    expect(screen.getByText("推測的")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Unreviewed Publisher Landing Page/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("許可リスト");
    expect(screen.getByRole("button", { name: "サードパーティ通知を表示" })).toBeInTheDocument();
  });
});
