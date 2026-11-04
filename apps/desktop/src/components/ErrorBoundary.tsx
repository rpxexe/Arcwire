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
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 text-slate-100 p-8 select-none">
          <div className="max-w-md w-full bg-slate-800/80 border border-slate-700/60 rounded-xl p-6 shadow-2xl flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center mb-4 text-amber-400">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Something went wrong</h1>
            <p className="text-sm text-slate-400 mb-4">
              An unexpected error occurred while rendering the Arcwire interface.
            </p>
            {this.state.error && (
              <pre className="w-full text-left bg-slate-950/80 p-3 rounded text-xs text-rose-400 overflow-x-auto mb-6 max-h-32 border border-slate-800 font-mono">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-colors shadow-lg shadow-indigo-600/30"
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
