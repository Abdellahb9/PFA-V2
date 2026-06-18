// Catches render/lazy-import errors so a failed chunk shows an error (and an
// automatic one-time reload to self-heal stale chunks after a redeploy)
// instead of an infinite Suspense fallback.
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Button, Result } from "antd";
import AppLoader from "@/components/AppLoader";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  reloading: boolean;
}

// Thrown when a previously-built lazy chunk is missing (redeploy) or fails to load.
const CHUNK_ERROR_RE =
  /dynamically imported module|module script failed|Loading chunk|Failed to fetch/i;
const RELOAD_FLAG = "phos_chunk_reloaded";

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): State {
    // Reload once for a stale-chunk error; otherwise show the error UI.
    const reloading =
      CHUNK_ERROR_RE.test(error.message) && !sessionStorage.getItem(RELOAD_FLAG);
    return { error, reloading };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    if (this.state.reloading) {
      sessionStorage.setItem(RELOAD_FLAG, "1");
      window.location.reload();
    }
    // (Hook for a real logging backend.)
    console.error("App error boundary caught:", error);
  }

  private handleReload = (): void => {
    sessionStorage.removeItem(RELOAD_FLAG);
    window.location.reload();
  };

  render(): ReactNode {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    // Auto-reload in progress -> neutral loader rather than an error flash.
    if (reloading) return <AppLoader tip="Mise à jour de l'application…" />;
    return (
      <Result
        status="error"
        title="Une erreur est survenue"
        subTitle="Le chargement de l'application a échoué. Veuillez réessayer."
        extra={
          <Button type="primary" onClick={this.handleReload}>
            Recharger
          </Button>
        }
      />
    );
  }
}
