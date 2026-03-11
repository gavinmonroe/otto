// ---------------------------------------------------------------------------
// OttoErrorBoundary — catches React errors in injected components so a
// single component crash doesn't take down the whole overlay or break
// GitLab's page.
//
// Class component because React error boundaries require getDerivedStateFromError.
// ---------------------------------------------------------------------------

import { Component, type ReactNode } from 'react';

type Props = {
  name: string;       // Component name for error display
  children?: ReactNode;
};

type State = {
  hasError: boolean;
  error: string | null;
};

export class OttoErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`[Otto] Error in ${this.props.name}:`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '8px 12px',
          fontSize: '12px',
          color: '#dc2626',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '6px',
          margin: '4px 0',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}>
          Otto ({this.props.name}) encountered an error: {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}
