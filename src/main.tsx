import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { primeCesiumToken } from "./lib/cesium";
import { settings } from "./lib/settings";
import "./styles.css";

// Prime the Cesium token from persisted settings before React renders the
// Globe. We mount the React tree immediately and let the token settle in
// the background — the globe defaults to OSM (no token required) so it's
// usable even before the token arrives. When the token write completes, a
// later Globe re-render picks it up via primeCesiumToken().
settings
  .getCesiumToken()
  .then((tok) => primeCesiumToken(tok || null))
  .catch(() => primeCesiumToken(null));

// Re-prime if the token changes via the Settings dialog.
if (typeof window !== "undefined") {
  window.addEventListener("tsunamisim:settings-saved", () => {
    settings.getCesiumToken().then((tok) => primeCesiumToken(tok || null)).catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
