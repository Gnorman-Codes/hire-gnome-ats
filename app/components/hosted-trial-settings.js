'use client';
import { useEffect, useState } from 'react';
import { formatDateTimeAt } from '@/lib/date-format';
export default function HostedTrialSettings() {
 const [trial, setTrial] = useState(null);
 useEffect(() => {
  let cancelled = false;
  fetch('/api/instance-access', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(value => { if (!cancelled) setTrial(value); }).catch(() => {});
  return () => { cancelled = true; };
 }, []);
 if (!trial?.enabled) return null;
 return <section className="form-section">
  <h4>Hosted Trial</h4>
  <p><strong>{trial.daysRemaining} days remaining</strong> in your {trial.days}-day trial.</p>
  <p>Expires {formatDateTimeAt(trial.expiresAt, { timeZone: 'UTC' })} UTC.</p>
  <p className="panel-subtext">Your hosting provider controls trial access. Normal use pauses when the trial expires; your records are retained. The monthly AI allowance still applies during the trial.</p>
 </section>;
}
