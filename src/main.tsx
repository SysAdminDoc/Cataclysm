import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { primeCesiumToken } from "./lib/cesium";
import { settings } from "./lib/settings";
import "./styles.css";

// Prime the Cesium token from persisted settings before React first renders
// the Globe, so the very first viewer mount has access. Failures fall through
// to the env-var path inside `primeCesiumToken(null)`.
settings.getCesiumToken().then((tok) => primeCesiumToken(tok || null)).catch(() => primeCesiumToken(null));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
