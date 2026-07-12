import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { primeCesiumToken } from "./lib/cesium";
import { markCrashReportSeen } from "./lib/diagnosticsLog";
import { settings } from "./lib/settings";
import "./styles.css";

// Prime the Cesium token from persisted settings before React renders the
// Globe. We mount the React tree immediately and let the token settle in
// the background — the globe defaults to bundled Natural Earth, so it is
// usable before any token or network tile request. When the token write completes, a
// later Globe re-render picks it up via primeCesiumToken().
settings
  .getCesiumToken()
  .then((tok) => primeCesiumToken(tok || null))
  .catch((err) => {
    console.warn("[settings] failed to load Cesium token", err);
    primeCesiumToken(null);
  });

// Re-prime if the token changes via the Settings dialog.
if (typeof window !== "undefined") {
  window.addEventListener("tsunamisim:settings-saved", () => {
    settings
      .getCesiumToken()
      .then((tok) => primeCesiumToken(tok || null))
      .catch((err) => console.warn("[settings] failed to refresh Cesium token", err));
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

// A successful start marks any prior crash report as reviewed (but keeps it for
// inspection) so it is not treated as a fresh failure on the next launch.
if (typeof window !== "undefined") {
  window.setTimeout(markCrashReportSeen, 0);
}
