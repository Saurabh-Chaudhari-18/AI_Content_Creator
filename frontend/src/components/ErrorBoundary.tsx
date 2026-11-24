import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/monitoring";
import { PRODUCT_NAME } from "@/lib/product";

const RELOAD_FLAG = "omnipost:chunk-reload";

/** A screen's code file is gone — usually because a new version was deployed
 * while this tab was open (the old hashed file names no longer exist). */
function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk .* failed/i.test(msg);
}

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) === "1";
  } catch {
    return false;
  }
}

function writeFlag(on: boolean) {
  try {
    if (on) sessionStorage.setItem(RELOAD_FLAG, "1");
    else sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    /* storage blocked: the manual Reload button still works */
  }
}

type Props = { children: ReactNode; fullPage?: boolean };
type State = { error: unknown };

/**
 * Catches a render error or a failed screen download so one broken screen
 * shows a recoverable message instead of blanking the whole app.
 * A missing code file after a deploy reloads the page once, automatically.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isChunkLoadError(error) && !readFlag()) {
      writeFlag(true);
      window.location.reload();
      return;
    }
    console.error("Screen crashed", error, info.componentStack);
    reportError(error, { componentStack: info.componentStack });
  }

  componentDidMount() {
    // This screen rendered: a later missing-file error may auto-reload again.
    writeFlag(false);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    const updated = isChunkLoadError(this.state.error);
    return (
      <div
        role="alert"
        className={`mx-auto flex max-w-md flex-col items-center gap-3 px-4 text-center ${this.props.fullPage ? "min-h-svh justify-center" : "pt-16"}`}
      >
        <h1 className="m-0 text-lg font-semibold">
          {updated ? `${PRODUCT_NAME} was updated` : "Something went wrong on this screen"}
        </h1>
        <p className="m-0 text-muted-foreground">
          {updated
            ? "Reload to get the latest version. Anything you saved is safe."
            : "Reload to try again. Anything you saved is safe; if this keeps happening, let us know."}
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}
