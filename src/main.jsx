import React from 'react';
import { createRoot } from 'react-dom/client';
import './storage.js'; // installs window.storage shim (backend + localStorage fallback)
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
