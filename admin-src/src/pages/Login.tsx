import { useState } from 'react';
import { sb } from '../lib/supabase';

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Email or password is incorrect.';
  if (lower.includes('email not confirmed')) return 'Please confirm your email — check your inbox for our verification link.';
  if (lower.includes('too many requests') || lower.includes('rate limit')) return 'Too many sign-in attempts. Please wait a minute and try again.';
  if (lower.includes('fetch') || lower.includes('network') || lower.includes('failed to fetch')) return 'Could not reach the authentication service. Check your internet connection.';
  return raw;
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) setErr(friendlyError(error.message));
    } catch (e: any) {
      setErr(friendlyError(e?.message || 'Unexpected error.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <div className="logo-mark">K</div>
          <div>
            <h1>Konek <span style={{ color: 'var(--tl)' }}>.admin</span></h1>
          </div>
        </div>
        <p className="sub">Sign in with your administrator account.</p>
        {err && <div className="alert alert-error"><i className="fa-solid fa-circle-exclamation"></i> {err}</div>}
        <div className="field">
          <label>Email</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@konek.ph" autoComplete="email" />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" required value={pw} onChange={e => setPw(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
