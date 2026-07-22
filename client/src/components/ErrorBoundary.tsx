import React, { Component } from 'react';

interface State { hasError: boolean; error: Error | null }

export default class ErrorBoundary extends Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 20,
          color: '#e94560',
          background: '#1a1a2e',
          height: '100%',
          overflow: 'auto',
          fontSize: 13,
        }}>
          <h3>出错了</h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>
            {this.state.error?.stack || this.state.error?.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
