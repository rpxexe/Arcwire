import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[React ErrorBoundary caught error]:', error, errorInfo);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-background text-foreground p-8 select-none">
          <div className="max-w-md w-full bg-card border border-border rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4 text-destructive">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-semibold text-foreground mb-2">Something went wrong</h1>
            <p className="text-sm text-muted-foreground mb-4">
              An unexpected error occurred while rendering the Arcwire interface.
            </p>
            {this.state.error && (
              <pre className="w-full text-left bg-muted p-3 rounded text-xs text-destructive overflow-x-auto mb-6 max-h-32 border border-border font-mono">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm transition-colors duration-150 ease-out hover:bg-primary/90 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-primary"
            >
              <RefreshCw className="w-4 h-4" />
              Reload Arcwire
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
