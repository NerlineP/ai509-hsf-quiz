import React from 'react';
import { createRoot } from 'react-dom/client';
import './storage.js'; // installs window.storage shim (backend + localStorage fallback)
import App from './App.jsx';

// Turns any render crash into a visible message (in Creole) instead of a blank
// white screen, and logs the real error to the console for diagnosis.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('App crashed:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
          <h1 style={{ color: '#E11D26' }}>Yon erè rive</h1>
          <p style={{ maxWidth: 420, margin: '0.5rem auto' }}>
            Tanpri rafrechi paj la. Si pwoblèm nan kontinye, kontakte contact@ai-509.com.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
