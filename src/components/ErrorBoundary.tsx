import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
  stack: string | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, stack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[app] Unhandled React render error", error, info.componentStack);
    this.setState({ stack: info.componentStack || null });
  }

  private retry = (): void => {
    this.setState({ error: null, stack: null });
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
            <button type="button" onClick={this.reload}>
              Reload app
            </button>
          </div>
        </section>
      </main>
    );
  }
}
