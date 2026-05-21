import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';

declare global {
  interface Window {
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
  }
}

const url = window.SUPABASE_URL;
const key = window.SUPABASE_ANON_KEY;
const configMissing = !url || !key || url.includes('YOUR-PROJECT');

if (configMissing) {
  console.error('[admin boot] config.js missing or has placeholder values.');
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div class="login-shell">
        <div class="login-card">
          <div class="brand"><div class="logo-mark">K</div><div><h1>Setup required</h1></div></div>
          <div class="alert alert-error" style="margin-top:12px"><i class="fa-solid fa-circle-exclamation"></i>
            Admin app configuration is missing. <code>config.js</code> did not load, or contains placeholder values. Please contact your administrator.
          </div>
        </div>
      </div>`;
  }
} else {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter basename="/admin">
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
}
