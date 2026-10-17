'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Pause, Play, Trash2, UserPlus } from 'lucide-react';
import { api } from './AdminShell';

// Alumnas: invitar, pausar/reactivar (reversible) y dar de baja (solo propietario, irreversible). Sin datos de perfil aquí.
type Row = { id: string; email: string; status: 'invited' | 'active' | 'paused'; invited_by: string | null; created_at: string };
const LABEL = { invited: 'Invitada', active: 'Activa', paused: 'Pausada' } as const;

export default function StudentsTab({ owner, onSessionLost }: { owner: boolean; onSessionLost: () => void }) {
  const [rows, setRows] = useState<Row[]>([]); const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const fail = useCallback((err: Error) => { if (err.message.includes('Sesión')) onSessionLost(); setError(err.message); }, [onSessionLost]);
  const load = useCallback(() => { setBusy(true); api<{ students: Row[] }>('students').then(d => { setRows(d.students); setError(''); }).catch(fail).finally(() => setBusy(false)); }, [fail]);
  useEffect(load, [load]);
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
    {busy ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p> : !rows.length ? <div className="empty"><h3>Aún no hay alumnas invitadas.</h3></div> : <div className="table-wrap"><table className="data-table">
      <thead><tr><th>Alumna</th><th>Estado</th><th>Alta</th><th /></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}>
        <td className="primary-cell"><strong>{r.email}</strong>{r.invited_by && <span>invitada por {r.invited_by}</span>}</td>
        <td><span className={r.status === 'active' ? 'status ok' : r.status === 'paused' ? 'status bad' : 'status'}>{LABEL[r.status]}</span></td>
        <td>{new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(r.created_at))}</td>
        <td style={{ textAlign: 'right' }}><button onClick={() => void toggle(r)} aria-label={`${r.status === 'paused' ? 'Reactivar' : 'Pausar'} a ${r.email}`}>{r.status === 'paused' ? <Play size={14} /> : <Pause size={14} />} {r.status === 'paused' ? 'Reactivar' : 'Pausar'}</button>{owner && <button onClick={() => void remove(r)} aria-label={`Dar de baja a ${r.email}`}><Trash2 size={14} /> Baja</button>}</td></tr>)}</tbody></table></div>}
  </section>;
}
