import { redirect } from 'next/navigation';
import { getHostedTrialStatus } from '@/lib/hosted-trial';
import { formatDateTimeAt } from '@/lib/date-format';
import TrialExpiredActions from '@/app/components/trial-expired-actions';
export const dynamic = 'force-dynamic';
export default async function TrialExpiredPage() {
 let trial;
 try { trial = await getHostedTrialStatus(); } catch { trial = null; }
 if (trial && !trial.expired) redirect('/');
 return <section className="auth-page"><article className="auth-card">
  <h1>{trial ? 'Your trial has expired' : 'Instance access unavailable'}</h1>
  <p className="auth-subtitle">{trial ? 'Your Hire Gnome trial has ended. Contact your hosting provider to activate or extend your access.' : 'Contact your hosting provider to restore access to this instance.'}</p>
  {trial?.expiresAt ? <p className="panel-subtext" style={{ paddingTop: '1rem' }}>Trial ended {formatDateTimeAt(trial.expiresAt, { timeZone: 'UTC' })} UTC.</p> : null}
  <p className="panel-subtext">Your records are retained. Normal use is paused until access is restored.</p>
  {trial?.contactEmail ? <p><a href={`mailto:${trial.contactEmail}`}>Contact your hosting provider</a></p> : null}
  <TrialExpiredActions />
 </article></section>;
}
