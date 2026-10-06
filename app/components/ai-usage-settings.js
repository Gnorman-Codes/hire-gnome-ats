'use client';
import { useEffect, useState } from 'react';
import FormField from './form-field';
import { formatDateTimeAt } from '@/lib/date-format';

const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value || 0);
export default function AiUsageSettings({ demoMode }) {
 const [usage, setUsage] = useState(null);
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 const [budget, setBudget] = useState('');
 const [enabled, setEnabled] = useState(true);
 const [retryProvider, setRetryProvider] = useState(false);
 function apply(data) { setUsage(data); setBudget(String(data.budgetUsd)); setEnabled(data.enabled); setRetryProvider(false); }
 async function load() {
  setBusy(true); setError('');
  try { const res = await fetch('/api/admin/ai-usage', { cache: 'no-store' }); const data = await res.json(); if (!res.ok) throw new Error(data.error); apply(data); }
  catch (err) { setError(err.message || 'Unable to load AI usage.'); }
  finally { setBusy(false); }
 }
 useEffect(() => { load(); }, []);
 async function save() {
  setBusy(true); setError('');
  try {
   const res = await fetch('/api/admin/ai-usage', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ budgetUsd: Number(budget), enabled, retryProvider }) });
   const data = await res.json(); if (!res.ok) throw new Error(data.error); apply(data);
  } catch (err) { setError(err.message || 'Unable to save AI controls.'); }
  finally { setBusy(false); }
 }
 const readOnly = busy || demoMode || usage?.controlsManaged;
 return <section className="form-section">
  <h4>AI Usage and Allowance</h4>
  {error ? <p role="alert">{error}</p> : null}
  {!usage && !error ? <p className="panel-subtext">Loading AI usage...</p> : null}
  {usage ? <>
   <p><strong>{usage.status}</strong> · {new Date(`${usage.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })} (UTC)</p>
   <div className="form-grid-2">
    <p>Estimated spend: <strong>{money(usage.spentUsd)}</strong></p>
    <p>Budget remaining: <strong>{money(usage.remainingUsd)}</strong></p>
   </div>
   <p className="panel-subtext">Allowance: {money(usage.budgetUsd)}. Reserved for pending requests: {money(usage.reservedUsd)}. Resets {formatDateTimeAt(usage.resetsAt, { timeZone: 'UTC' })} UTC. Estimates cover requests recorded by this instance after usage tracking was installed; OpenAI billing remains authoritative.</p>
   {usage.controlsManaged ? <p className="panel-subtext">Your hosting provider controls the allowance and disable switch.</p> : <>
    <div className="form-grid-2 ai-allowance-controls">
    <FormField label="Monthly AI allowance (USD)" hint="Set 0 to pause AI.">
     <input type="number" min="0" max="100000" step="0.01" value={budget} onChange={e => setBudget(e.target.value)} disabled={readOnly} />
    </FormField>
    <label className="switch-field">
     <input type="checkbox" className="switch-input" checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={readOnly} />
     <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
     <span className="switch-copy"><span className="switch-label">Enable AI features</span></span>
    </label>
    </div>
    <p className="panel-subtext">Resume uploads continue with built-in parsing when AI is paused.</p>
    {usage.providerBlocked ? <label className="switch-field">
     <input type="checkbox" className="switch-input" checked={retryProvider} onChange={e => setRetryProvider(e.target.checked)} disabled={readOnly} />
     <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
     <span className="switch-copy"><span className="switch-label">Retry after updating the OpenAI limit or credits</span></span>
    </label> : null}
    <button type="button" onClick={save} disabled={readOnly || budget.trim() === '' || !Number.isFinite(Number(budget)) || Number(budget) < 0 || Number(budget) > 100000}>{busy ? 'Saving...' : 'Save AI Controls'}</button>
   </>}
   {usage.features.length ? <table><thead><tr><th>Feature</th><th>Requests</th><th>Estimated spend</th></tr></thead><tbody>{usage.features.map(row => <tr key={row.feature}><td>{row.label}</td><td>{row.requests}</td><td>{money(row.spentUsd)}</td></tr>)}</tbody></table> : <p className="panel-subtext">No recorded AI requests this month.</p>}
  </> : null}
  <button type="button" onClick={load} disabled={busy}>Refresh AI Usage</button>
 </section>;
}
