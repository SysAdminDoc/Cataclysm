import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  persistCrashReport,
  readPersistedCrashReport,
  serializeRedactedDiagnostics,
} from "../lib/diagnosticsLog";
import { settings } from "../lib/settings";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
  stack: string | null;
  actionNote: string | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null, actionNote: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, stack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[app] Unhandled React render error", error, info.componentStack);
    const componentStack = info.componentStack || null;
    this.setState({ stack: componentStack });
    // Persist a redacted report so it survives the reload the user is about to do.
    persistCrashReport({ source: "react-boundary", name: error.name, message: error.message, componentStack });
  }

  private buildReportText(): string {
    const report = readPersistedCrashReport();
    if (report) return serializeRedactedDiagnostics(report);
    return serializeRedactedDiagnostics(
      { name: this.state.error?.name, message: this.state.error?.message, componentStack: this.state.stack },
    );
  }

  private copyDiagnostics = (): void => {
    const text = this.buildReportText();
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) {
      this.setState({ actionNote: "Clipboard access is unavailable. Save the diagnostics file instead." });
      return;
    }
    void writeText.call(navigator.clipboard, text).then(
      () => this.setState({ actionNote: "Diagnostics copied to clipboard." }),
      () => this.setState({ actionNote: "Could not access the clipboard." }),
    );
  };

  private saveDiagnostics = (): void => {
    try {
      const blob = new Blob([this.buildReportText()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cataclysm-diagnostics.json";
      a.click();
      URL.revokeObjectURL(url);
      this.setState({ actionNote: "Saved diagnostics file." });
    } catch {
      this.setState({ actionNote: "Could not save the diagnostics file." });
    }
  };

  private resetVisualSettings = (): void => {
    this.setState({ actionNote: "Resetting visual settings…" });
    void settings.resetVisualSettings().then(
      () => window.location.reload(),
      (error) => this.setState({
        actionNote: `Could not reset visual settings: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  };

  private retry = (): void => {
    this.setState({ error: null, stack: null, actionNote: null });
  };

  private reload = (): void => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-fatal" role="alert" aria-labelledby="app-fatal-title">
        <section className="app-fatal__panel">
          <p className="app-fatal__eyebrow">Runtime recovery</p>
          <h1 id="app-fatal-title">Something went wrong</h1>
          <p>
            The interface hit an unexpected rendering error. The diagnostics
            log captured the component stack so the failure can be reviewed.
          </p>
          <pre className="app-fatal__message">
            {this.state.error.name}: {this.state.error.message}
          </pre>
          {this.state.stack && (
            <details className="app-fatal__details">
              <summary>Component stack</summary>
              <pre>{this.state.stack}</pre>
            </details>
          )}
          <div className="app-fatal__actions">
            <button className="primary" type="button" onClick={this.retry}>
              Try again
            </button>
            <button type="button" onClick={this.resetVisualSettings}>
              Reset visual settings
            </button>
            <button type="button" onClick={this.reload}>
              Reload app
            </button>
            <button type="button" onClick={this.copyDiagnostics}>
              Copy diagnostics
            </button>
            <button type="button" onClick={this.saveDiagnostics}>
              Save diagnostics
            </button>
          </div>
          {this.state.actionNote && (
            <p className="app-fatal__note" role="status">{this.state.actionNote}</p>
          )}
        </section>
      </main>
    );
  }
}
