'use client';
import { useState } from 'react';
export default function TrialExpiredActions() {
 const [busy, setBusy] = useState(false);
 async function signOut() {
  setBusy(true);
  await fetch('/api/session/logout', { method: 'POST' }).catch(() => {});
  window.location.assign('/login');
 }
 return <button type="button" onClick={signOut} disabled={busy}>{busy ? 'Signing out...' : 'Return to sign in'}</button>;
}
