import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { primeCesiumToken } from "../lib/cesium";
import { settings, type Theme } from "../lib/settings";
import { setTheme } from "../lib/theme";
import { GLOBE_STYLES, type GlobeStyleId } from "../lib/globe-styles";
import { isTauri } from "../lib/tauri";

type Props = { onClose: () => void };

export function Settings({ onClose }: Props) {
  useEscapeKey(onClose);
  const [token, setTokenLocal] = useState("");
  const [theme, setThemeLocal] = useState<Theme>("mocha");
  const [globeStyle, setGlobeStyle] = useState<GlobeStyleId>("osm");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    settings.loadAll().then((s) => {
      setTokenLocal(s.cesium_token);
      setThemeLocal(s.theme);
      setGlobeStyle(s.globe_style);
    });
  }, []);

  async function save() {
    setSaveErr(null);
    const trimmedToken = token.trim();
    // Apply the token immediately so the next imagery request sees it,
    // even if the persistence write below races. This makes 'Save' feel
    // instant even on slow disks.
    primeCesiumToken(trimmedToken || null);
    try {
      await Promise.all([
        settings.setCesiumToken(trimmedToken),
        setTheme(theme),
        settings.setGlobeStyle(globeStyle),
      ]);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("[settings] save failed", err);
      setSaveErr(String(err));
    }
    // Always dispatch — Globe + main.tsx listen for this to re-read the
    // active style + token. Even if persistence failed the in-memory
    // values are still useful for the current session.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
    }
  }

  const needsToken = GLOBE_STYLES.find((s) => s.id === globeStyle)?.requires_token ?? false;

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <h2>Settings</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal__body">
          <section style={{ marginBottom: 20 }}>
            <h3 className="settings__h3">Globe imagery</h3>
            <p className="modal__intro">
              Pick how the globe is rendered. The default
              (<strong>OpenStreetMap</strong>) works out of the box — no token,
              no setup. Higher-fidelity Cesium ion layers (bathymetry, satellite)
              require a free token (Section below).
            </p>
            <select
              value={globeStyle}
              onChange={(e) => setGlobeStyle(e.target.value as GlobeStyleId)}
            >
              {GLOBE_STYLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className="modal__footnote" style={{ marginTop: 8 }}>
              {GLOBE_STYLES.find((s) => s.id === globeStyle)?.description}
            </p>
          </section>

          <section style={{ marginBottom: 20 }}>
            <h3 className="settings__h3">
              Cesium ion access token{!needsToken && " (optional)"}
            </h3>
            <p className="modal__intro">
              Optional. Only needed if you select a Cesium ion-backed globe
              style above (terrain, bathymetry, satellite imagery). Token is
              stored locally in your <code>app_data_dir</code> +
              <code>localStorage</code> — never embedded in the binary or sent
              anywhere except <code>cesium.com</code>. Get a free token at{" "}
              <a
                href="https://cesium.com/ion/signup"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  if (isTauri()) {
                    openExternal("https://cesium.com/ion/signup").catch((err) =>
                      console.error("shell open failed", err),
                    );
                  } else {
                    window.open("https://cesium.com/ion/signup", "_blank", "noopener,noreferrer");
                  }
                }}
              >
                cesium.com/ion/signup
              </a>
              .
            </p>
            <input
              type="password"
              autoComplete="off"
              placeholder={needsToken ? "Required for this globe style…" : "Paste your token here (optional)…"}
              value={token}
              onChange={(e) => setTokenLocal(e.target.value)}
            />
          </section>

          <section style={{ marginBottom: 20 }}>
            <h3 className="settings__h3">Theme</h3>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="scenario-tab"
                data-active={theme === "mocha" ? "true" : "false"}
                onClick={() => setThemeLocal("mocha")}
              >
                Catppuccin Mocha (dark)
              </button>
              <button
                className="scenario-tab"
                data-active={theme === "latte" ? "true" : "false"}
                onClick={() => setThemeLocal("latte")}
              >
                Catppuccin Latte (light)
              </button>
            </div>
          </section>

          <section style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="primary" onClick={save}>Save settings</button>
            {savedAt && !saveErr && (
              <span style={{ color: "var(--green)", fontSize: 12 }}>Saved at {savedAt}</span>
            )}
            {saveErr && (
              <span style={{ color: "var(--red)", fontSize: 12 }}>Save failed: {saveErr}</span>
            )}
          </section>

          <hr className="modal__sep" />

          <section style={{ marginBottom: 20 }}>
            <h3 className="settings__h3">Advanced</h3>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="scenario-tab"
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Show the first-run disclaimer modal again on next launch?",
                    )
                  ) {
                    return;
                  }
                  await settings.clearDisclaimerAck();
                  setSavedAt("First-run modal will appear on next launch.");
                }}
              >
                Show first-run again
              </button>
              <button
                className="scenario-tab"
                onClick={async () => {
                  await settings.clearTourCompleted();
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
                  }
                  setSavedAt("Tour will replay shortly.");
                  onClose();
                }}
              >
                Replay tour
              </button>
              <button
                className="scenario-tab"
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Reset every setting (token, theme, globe style, first-run ack) to defaults? This can't be undone.",
                    )
                  ) {
                    return;
                  }
                  await settings.resetAll();
                  setTokenLocal("");
                  setThemeLocal("mocha");
                  setGlobeStyle("osm");
                  primeCesiumToken(null);
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved"));
                  }
                  setSavedAt("Reset complete.");
                }}
              >
                Reset to defaults
              </button>
            </div>
          </section>

          <p className="modal__footnote">
            For evacuation warnings use <strong>NOAA NTWC / PTWC</strong> — this
            tool is for education and hazard awareness only.
          </p>
        </div>
      </div>
    </div>
  );
}
