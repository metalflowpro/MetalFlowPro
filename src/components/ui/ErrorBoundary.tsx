import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Optional label to identify which area failed (e.g. the module name). */
  label?: string;
  /** Remount key: when it changes, the boundary resets (e.g. on page change). */
  resetKey?: string | number;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render/runtime errors in a subtree so one failing module does not blank
 * the whole application. Shows a recoverable fallback with a retry action.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: Props) {
    // Reset the boundary when the caller signals a context change (e.g. navigation).
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ''}]`, error, info.componentStack);
  }

  handleRetry = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
          <AlertTriangle className="w-7 h-7 text-red-400" />
        </div>
        <h2 className="text-lg font-semibold text-white mb-1">
          Une erreur est survenue{this.props.label ? ` dans le module « ${this.props.label} »` : ''}
        </h2>
        <p className="text-sm text-slate-400 max-w-md mb-2">
          Ce module a rencontré une erreur inattendue. Les autres modules restent utilisables.
        </p>
        {this.state.error?.message && (
          <pre className="text-xs text-slate-500 bg-slate-800/60 rounded px-3 py-2 max-w-lg overflow-auto mb-4">
            {this.state.error.message}
          </pre>
        )}
        <button
          onClick={this.handleRetry}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-medium text-white transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Réessayer
        </button>
      </div>
    );
  }
}
