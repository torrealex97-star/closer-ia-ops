'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, Pause, Play, Trash2, UserPlus } from 'lucide-react';
import { api } from './AdminShell';
import { REVIEW_REFS } from './trainingRefs';
import StudentActivityDashboard from './StudentActivityDashboard';

// Alumnas: invitar, pausar/reactivar (reversible) y dar de baja (solo propietario, irreversible). Sin datos de perfil aquí.
type Row = { id: string; email: string; status: 'invited' | 'active' | 'paused'; invited_by: string | null; created_at: string };
type Summary = { sessions: number; last_seen: string | null; practice: { count: number; avg: number | null }; training: { modules: string[]; examBest: number | null; examPassed: boolean }; apps?: { sent: number; responded: number } | null; streak: { current: number } };
type Overview = { students: Row[]; days: number; activity_available: boolean; applications_available?: boolean; activity: { student: { id: string }; summary: Summary }[]; totals: { entered7: number; active: number; practices: number; exams_passed: number } | null; truncated: boolean };
const PERIODS = [7, 30, 90] as const;
const when = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' });
const LABEL = { invited: 'Invitada', active: 'Activa', paused: 'Pausada' } as const;

export default function StudentsTab({ owner, onSessionLost }: { owner: boolean; onSessionLost: () => void }) {
  const [rows, setRows] = useState<Row[]>([]); const [email, setEmail] = useState('');
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30); const [overview, setOverview] = useState<Overview | null>(null); const seq = useRef(0);
  const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const fail = useCallback((err: Error) => { if (err.message.includes('Sesión')) onSessionLost(); setError(err.message); }, [onSessionLost]);
  const load = useCallback(() => {
    const mine = ++seq.current; setBusy(true);
    api<Overview>(`students?days=${days}`).then(d => { if (mine !== seq.current) return; setRows(d.students); setOverview(d); setError(''); }).catch(err => { if (mine === seq.current) fail(err as Error); }).finally(() => { if (mine === seq.current) setBusy(false); });
  }, [fail, days]);
  useEffect(load, [load]);
  const summaries = useMemo(() => new Map((overview?.activity ?? []).map(a => [a.student.id, a.summary])), [overview]);
  const live = overview?.activity_available === true;
  async function invite(e: React.FormEvent) {
    e.preventDefault(); setError(''); setNotice('');
    try { const r = await api<{ email_sent: boolean }>('students', { method: 'POST', body: JSON.stringify({ email }) }); setNotice(r.email_sent ? `Invitación enviada a ${email}.` : `${email} añadida, pero el correo no salió: pídele que use «¿Has olvidado tu contraseña?».`); setEmail(''); load(); } catch (err) { setError((err as Error).message); }
  }
  async function toggle(r: Row) {
    setError(''); setNotice('');
    try { await api('students', { method: 'PATCH', body: JSON.stringify({ id: r.id, status: r.status === 'paused' ? 'active' : 'paused' }) }); load(); } catch (err) { fail(err as Error); }
  }
  async function remove(r: Row) {
    if (!window.confirm(`¿Dar de baja a ${r.email}? Se borra su cuenta y su perfil. No se puede deshacer.`)) return;
    setError(''); setNotice('');
    try { await api(`students?id=${r.id}`, { method: 'DELETE' }); setNotice(`Baja de ${r.email}.`); load(); } catch (err) { fail(err as Error); }
  }
  return <section aria-label="Alumnas">
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {notice && <div className="auth-note" role="status" style={{ marginBottom: 20 }}>{notice}</div>}
    <form className="search-panel admin-toolbar" onSubmit={invite} style={{ marginBottom: 28 }}>
      <label className="grow" htmlFor="student-invite">Invitar a una alumna<input id="student-invite" type="email" required placeholder="nombre@correo.com" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <button className="primary" disabled={!email}><UserPlus size={16} /> Enviar invitación</button></form>
    <p className="card-meta">Acceden en <strong>/alumna</strong>. Los vídeos no se guardan: cada alumna pone el enlace a su propio Drive.</p>
    <div className="training-chips" role="group" aria-label="Periodo de actividad">{PERIODS.map(p => <button key={p} aria-pressed={days === p} onClick={() => setDays(p)}>Últimos {p} días</button>)}</div>
    {overview && !live && <div className="alert" role="status"><span>La actividad de las alumnas no se pudo leer ahora mismo (la tabla puede no estar creada todavía). Se muestra «—» en vez de ceros; la lista de acceso funciona igual.</span></div>}
    {overview && live && overview.totals && <div className="stat-strip" aria-label={`Actividad de los últimos ${overview.days} días`}><span><strong>{overview.totals.entered7}</strong>entraron en 7 días</span><span><strong>{overview.totals.active}</strong>con actividad en {overview.days} días</span><span><strong>{overview.totals.practices}</strong>prácticas</span><span><strong>{overview.totals.exams_passed}</strong>con examen superado</span></div>}
    {overview && live && <StudentActivityDashboard students={rows} summaries={summaries} days={overview.days} appsAvailable={overview.applications_available !== false} />}
    {overview?.truncated && <p className="card-meta" role="status">Hay más de 5.000 movimientos en el periodo: los totales pueden quedarse cortos.</p>}
    {busy ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p> : !rows.length ? <div className="empty"><h3>Aún no hay alumnas invitadas.</h3></div> : <div className="table-wrap"><table className="data-table">
      <thead><tr><th>Alumna</th><th>Estado</th><th>Alta</th><th>Última entrada</th><th className="num">Prácticas</th><th className="num">Formación</th><th>Examen</th><th /></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}>
        <td className="primary-cell"><strong>{r.email}</strong>{r.invited_by && <span>invitada por {r.invited_by}</span>}</td>
        <td><span className={r.status === 'active' ? 'status ok' : r.status === 'paused' ? 'status bad' : 'status'}>{LABEL[r.status]}</span></td>
        <td>{new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(r.created_at))}</td>
        {(() => { const a = summaries.get(r.id); return <>
          <td>{!live ? '—' : a?.last_seen ? when.format(new Date(a.last_seen)) : 'Sin actividad'}</td>
          <td className="num">{!live ? '—' : a ? `${a.practice.count}${a.practice.avg !== null ? ` · media ${a.practice.avg}` : ''}` : 0}</td>
          <td className="num">{!live ? '—' : `${a?.training.modules.length ?? 0}/${REVIEW_REFS.length}`}</td>
          <td>{!live ? '—' : a?.training.examBest == null ? 'Sin intentar' : `${a.training.examBest}/100 · ${a.training.examPassed ? 'superado' : 'no superado'}`}</td></>; })()}
        <td style={{ textAlign: 'right' }}><button onClick={() => void toggle(r)} aria-label={`${r.status === 'paused' ? 'Reactivar' : 'Pausar'} a ${r.email}`}>{r.status === 'paused' ? <Play size={14} /> : <Pause size={14} />} {r.status === 'paused' ? 'Reactivar' : 'Pausar'}</button>{owner && <button onClick={() => void remove(r)} aria-label={`Dar de baja a ${r.email}`}><Trash2 size={14} /> Baja</button>}</td></tr>)}</tbody></table></div>}
  </section>;
}
