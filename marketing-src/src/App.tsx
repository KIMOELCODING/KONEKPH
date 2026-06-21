import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { sb } from './lib/supabase';
import type { Profile } from './types';
import Login from './pages/Login';
import Shell from './components/Shell';

// Route-level code splitting — login flow doesn't need the page bundles.
const Queue  = lazy(() => import('./pages/Queue'));
const Editor = lazy(() => import('./pages/Editor'));
const Leads  = lazy(() => import('./pages/Leads'));

function PageFallback() {
  return <div className="card"><p className="muted">Loading…</p></div>;
}

type AuthState =
  | { kind: 'loading' }
  | { kind: 'anon' }
  | { kind: 'ok'; profile: Profile }
  | { kind: 'notAllowed' }
  | { kind: 'error'; reason: string };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });
  const nav = useNavigate();
  const loc = useLocation();

  async function resolveAuth({ allowTransient = false }: { allowTransient?: boolean } = {}) {
    const mkTimeout = () => new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 8000));
    try {
      const sessionResult = await Promise.race([
        (async () => {
          const { data: { session } } = await sb.auth.getSession();
          return { user: session?.user ?? null };
        })(),
        mkTimeout(),
      ]);
      if (sessionResult === 'timeout') {
        console.error('[marketing auth] getSession timed out after 8s.');
        if (!allowTransient) setAuth({ kind: 'error', reason: 'Could not reach the authentication service. Check your internet connection and try again.' });
        return;
      }
      const user = sessionResult.user;
      if (!user) { setAuth({ kind: 'anon' }); return; }

      const profileResult = await Promise.race([
        sb.from('profiles').select('id, first_name, last_name, email, role, created_at').eq('id', user.id).single(),
        mkTimeout(),
      ]);
      if (profileResult === 'timeout') {
        console.error('[marketing auth] profile fetch timed out after 8s.');
        if (!allowTransient) setAuth({ kind: 'error', reason: 'Signed in, but your profile could not be loaded. Try again in a moment.' });
        return;
      }
      const { data: profile, error } = profileResult;
      if (error) {
        console.error('[marketing auth] profile fetch error:', error);
        if (!allowTransient) setAuth({ kind: 'error', reason: 'Signed in, but your profile could not be loaded: ' + (error.message || 'unknown error') });
        return;
      }
      if (!profile) { setAuth({ kind: 'anon' }); return; }
      // Marketing team (and admins, who can do everything) may enter.
      if (profile.role !== 'marketing' && profile.role !== 'admin') { setAuth({ kind: 'notAllowed' }); return; }
      setAuth({ kind: 'ok', profile: profile as Profile });
    } catch (e) {
      console.error('[marketing auth] resolveAuth threw:', e);
      if (!allowTransient) setAuth({ kind: 'error', reason: 'Unexpected error during sign-in. See console for details.' });
    }
  }

  useEffect(() => {
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { setAuth({ kind: 'anon' }); return; }
      if (event === 'SIGNED_IN') { resolveAuth(); return; }
      if (event === 'INITIAL_SESSION') { resolveAuth(); return; }
      resolveAuth({ allowTransient: true });
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (auth.kind === 'anon' && loc.pathname !== '/login') nav('/login', { replace: true });
    if (auth.kind === 'ok' && loc.pathname === '/login') nav('/queue', { replace: true });
  }, [auth.kind, loc.pathname]);

  if (auth.kind === 'loading') {
    return <div className="login-shell"><div className="login-card"><p className="muted">Loading…</p></div></div>;
  }

  if (auth.kind === 'error') {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="brand"><div className="logo-mark">P</div><div><h1>Connection problem</h1></div></div>
          <div className="alert alert-error"><i className="fa-solid fa-circle-exclamation"></i> {auth.reason}</div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { setAuth({ kind: 'loading' }); resolveAuth(); }}>
            Retry
          </button>
          <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={async () => {
            try { await sb.auth.signOut(); } catch {}
            setAuth({ kind: 'anon' });
          }}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (auth.kind === 'notAllowed') {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="brand"><div className="logo-mark">P</div><div><h1>Access Denied</h1></div></div>
          <p className="sub">This account is not on the marketing team. Brokers log in at the main app; admins at the admin portal.</p>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={async () => {
            await sb.auth.signOut();
            setAuth({ kind: 'anon' });
          }}>Sign out</button>
        </div>
      </div>
    );
  }

  if (auth.kind === 'anon') {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Shell profile={auth.profile} onSignOut={async () => { await sb.auth.signOut(); }}>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/queue" replace />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/queue/:id" element={<Editor />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="*" element={<Navigate to="/queue" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
