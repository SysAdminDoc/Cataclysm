import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { primeCesiumToken } from "./lib/cesium";
import { importNativePanicReport, installGlobalCrashHandlers } from "./lib/diagnosticsLog";
import { settings } from "./lib/settings";
import { isTauri } from "./lib/tauri";
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
  installGlobalCrashHandlers(window);
  void importNativePanicReport();
  if (import.meta.env.PROD && !isTauri() && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
        console.warn("[pwa] offline service worker registration failed", error);
      });
    });
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
