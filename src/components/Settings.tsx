import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { primeCesiumToken } from "../lib/cesium";
import { settings, type Theme } from "../lib/settings";
import { setTheme } from "../lib/theme";
import { isTauri } from "../lib/tauri";

type Props = { onClose: () => void };

export function Settings({ onClose }: Props) {
  const [token, setTokenLocal] = useState("");
  const [theme, setThemeLocal] = useState<Theme>("mocha");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    settings.loadAll().then((s) => {
      setTokenLocal(s.cesium_token);
      setThemeLocal(s.theme);
    });
  }, []);

  async function save() {
    await settings.setCesiumToken(token.trim());
    primeCesiumToken(token.trim() || null);
    await setTheme(theme);
    setSavedAt(new Date().toLocaleTimeString());
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <h2>Settings</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal__body">
          <section style={{ marginBottom: 20 }}>
            <h3 className="settings__h3">Cesium ion access token</h3>
            <p className="modal__intro">
              Required for 3D globe streaming (terrain, imagery, bathymetry).
              Tokens are stored locally in your <code>app_data_dir</code> — they
              are never embedded in the binary or sent anywhere except
              <code> cesium.com</code>. Get a free token at{" "}
              <a
                href="https://cesium.com/ion/signup"
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
              placeholder="Paste your token here…"
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

          <section style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="primary" onClick={save}>Save settings</button>
            {savedAt && <span style={{ color: "var(--green)", fontSize: 12 }}>Saved at {savedAt}</span>}
          </section>

          <hr className="modal__sep" />
          <p className="modal__footnote">
            For evacuation warnings use <strong>NOAA NTWC / PTWC</strong> — this
            tool is for education and hazard awareness only.
          </p>
        </div>
      </div>
    </div>
  );
}
