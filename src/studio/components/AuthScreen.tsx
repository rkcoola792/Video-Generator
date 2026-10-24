import { useState, type FormEvent } from 'react';

type Account = { id: string; email: string; displayName: string };

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: Account) => Promise<void> | void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`/api/v1/auth/${mode}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName }),
      });
      const payload = await response.json() as { user?: Account; error?: string };
      if (!response.ok || !payload.user) throw new Error(payload.error || 'Could not sign in.');
      await onAuthenticated(payload.user);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reach the account service.'); }
    finally { setBusy(false); }
  };

  return <main className="auth-shell">
    <section className="auth-card">
      <div className="auth-brand"><span className="brand-mark">✳</span><div><strong>little lessons</strong><small>VIDEO STUDIO</small></div></div>
      <div className="eyebrow">YOUR OWN CREATIVE SPACE</div>
      <h1>{mode === 'register' ? 'Make room for ideas.' : 'Welcome back.'}</h1>
      <p className="auth-intro">{mode === 'register' ? 'Create an account to save and revisit your lesson videos.' : 'Sign in to pick up where your lessons left off.'}</p>
      <form onSubmit={submit} className="auth-form">
        {mode === 'register' && <label>Your name<input autoComplete="name" value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Name" maxLength={80} /></label>}
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" maxLength={254} /></label>
        <label>Password<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 10 : 1} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'} maxLength={200} /></label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'} <span>→</span></button>
      </form>
      <div className="auth-switch">{mode === 'register' ? 'Already have an account?' : 'New to Little Lessons?'} <button onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }}>{mode === 'register' ? 'Sign in' : 'Create account'}</button></div>
      <small className="auth-storage-note">Your account and lesson drafts are stored in this app’s PostgreSQL database.</small>
    </section>
  </main>;
}
