import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
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
  window.addEventListener("error", (event) => {
    console.error("[app] Unhandled window error", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[app] Unhandled promise rejection", event.reason);
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
