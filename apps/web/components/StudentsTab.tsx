'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GraduationCap, LoaderCircle, MessageSquare, Pause, Play, RefreshCcw, Search, Target, Trash2, TrendingUp, UserPlus, X } from 'lucide-react';
import { api } from './AdminShell';
import { TRAINING_MODULES } from './trainingContent';
import { PRACTICE_SCENARIOS } from './practiceScenarios';
import { AxisBars, CompetenceRadar, WeekBars, band } from './ProgressBars';

// Alumnas: invitar, pausar/reactivar (reversible) y dar de baja (solo propietario).
// Encima de eso, el seguimiento real: quién tiene acceso, quién entra, quién
// practica y quién no, con qué nota, qué criterio le frena y cómo evoluciona.
// Una alumna sin señales se escribe «sin actividad», nunca con ceros inventados.
type Row = { id: string; email: string; status: 'invited' | 'active' | 'paused'; invited_by: string | null; created_at: string };
type EventRow = { id: string; kind: 'session' | 'practice' | 'training_review' | 'training_exam'; ref: string | null; score: number | null; detail: Record<string, unknown>; created_at: string };
type AxisStat = { id: string; label: string; average: number; count: number };
type WeekStat = { start: string; count: number; average: number | null };
type ScenarioStat = { id: string; count: number; average: number | null; last: string | null };
type Summary = {
  sessions: number;
  lastSeen: string | null;
  practice: { count: number; last: string | null; best: number | null; average: number | null };
  training: { modules: string[]; lastReview: string | null; examBest: number | null; examPassed: boolean; examLast: string | null };
  streak?: number;
  axes?: AxisStat[];
  weeks?: WeekStat[];
  scenarios?: ScenarioStat[];
};
type Progress = { student: Row; summary: Summary; recent: EventRow[] };
// Agregado del equipo: medias ponderadas por prácticas, nunca media de medias.
type TeamAxis = { id: string; label: string; average: number; practices: number; students: number };
type TeamWeek = { start: string; count: number; average: number | null; students: number };
type Team = {
  students: number; practicing: number; practiceTotal: number; practiceAverage: number | null;
  axes: TeamAxis[]; weakest: TeamAxis | null;
  weakestScenario: { id: string; count: number; average: number | null } | null;
  weeks: TeamWeek[]; inStreak: number; needsHelp: number; neverEntered: number;
};
type Totals = { students: number; active: number; entered7: number; practiced7: number; practiced?: number; neverPracticed?: number; examPassed: number; neverEntered: number };
type Data = {
  students: Row[];
  activity: Progress[];
  totals: Totals;
  team?: Team | null;
  window_days: number;
  // false = la actividad no se pudo leer: se dice, no se pinta como cero.
  activity_available?: boolean;
  truncated?: boolean;
};

const LABEL = { invited: 'Invitada', active: 'Activa', paused: 'Pausada' } as const;
const WINDOWS = [7, 30, 90];
const FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'practicing', label: 'Practican' },
  { id: 'not-practicing', label: 'Sin práctica' },
  { id: 'never-entered', label: 'Sin entrar' },
] as const;
type Filter = (typeof FILTERS)[number]['id'];

const date = (value: string | null) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(value)) : '—';
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
const moduleTitle = (id: string) => TRAINING_MODULES.find(item => item.id === id)?.title ?? id;
const scenarioTitle = (id: string | null) => PRACTICE_SCENARIOS.find(item => item.id === id)?.title ?? (id ?? 'situación');
const bandWord = (score: number) => score >= 70 ? 'sólido' : score >= 40 ? 'en progreso' : 'a mejorar';
// Seguimiento por uso, no por nota: la puntuación es una estimación de rúbrica.
const riskOf = (p: Summary) => {
  if (!p.lastSeen) return { id: 'sin_entrar', label: 'Nunca ha entrado', tone: 'warn' as const, weight: 3 };
  if (p.practice.count === 0) return { id: 'sin_practicar', label: 'Entra, no practica', tone: 'warn' as const, weight: 3 };
  const last = p.practice.last ? Date.parse(p.practice.last) : NaN;
  if (!Number.isFinite(last) || Date.now() - last > 7 * 864e5) return { id: 'inactiva', label: 'Sin practicar desde hace +7 días', tone: 'neutral' as const, weight: 2 };
  return { id: 'practicando', label: 'Practica esta semana', tone: 'ok' as const, weight: 1 };
};
const weakestOf = (p: Summary) => (p.axes ?? []).length ? [...(p.axes ?? [])].sort((a, b) => a.average - b.average)[0] : null;
const eventLabel = (event: EventRow) => event.kind === 'session' ? 'Entrada' : event.kind === 'practice' ? `Práctica · ${scenarioTitle(event.ref)}` : event.kind === 'training_review' ? `Formación · ${moduleTitle(event.ref ?? '')}` : 'Examen de egreso';
const eventResult = (event: EventRow) => event.kind === 'training_exam' ? `${event.score ?? '—'}/100${event.detail.passed === true ? ' · superado' : ''}` : event.kind === 'practice' ? `${event.score ?? '—'}/100` : event.kind === 'training_review' && typeof event.detail.met === 'number' ? `${event.detail.met}/${event.detail.total} criterios` : '';

export default function StudentsTab({ owner, onSessionLost }: { owner: boolean; onSessionLost: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [activity, setActivity] = useState<Progress[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [windowDays, setWindowDays] = useState(30);
  const [email, setEmail] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<Progress | null>(null);
  const [available, setAvailable] = useState(true);
  const [truncated, setTruncated] = useState(false);
  // Cambiar de periodo rápido podía dejar pintada la respuesta del periodo anterior.
  const seq = useRef(0);
  const fail = useCallback((err: Error) => { if (err.message.includes('Sesión')) onSessionLost(); setError(err.message); }, [onSessionLost]);
  const load = useCallback(() => {
    const id = ++seq.current;
    setBusy(true);
    api<Data>(`students?days=${windowDays}`).then(d => {
      if (id !== seq.current) return;
      setRows(d.students); setActivity(d.activity ?? []); setTotals(d.totals ?? null); setTeam(d.team ?? null);
      setAvailable(d.activity_available !== false); setTruncated(Boolean(d.truncated)); setError('');
      // Sin datos de actividad, un filtro por actividad mentiría: se vuelve a «Todas».
      if (d.activity_available === false) setFilter('all');
    }).catch(err => { if (id === seq.current) fail(err as Error); })
      .finally(() => { if (id === seq.current) setBusy(false); });
  }, [fail, windowDays]);
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
    if (!window.confirm(`¿Dar de baja a ${r.email}? Se borra su cuenta, su perfil y su actividad. No se puede deshacer.`)) return;
    setError(''); setNotice('');
    try { await api(`students?id=${r.id}`, { method: 'DELETE' }); setNotice(`Baja de ${r.email}.`); load(); } catch (err) { fail(err as Error); }
  }

  // Orden por defecto: primero a quien hay que mirar (nunca entró, entra y no
  // practica, lleva una semana sin practicar) y después la actividad más reciente.
  // No ordena por nota: comparar estimaciones entre alumnas no es un criterio.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const summaryOf = (id: string) => activity.find(item => item.student.id === id)?.summary;
    return rows.filter(row => {
      if (needle && !row.email.toLowerCase().includes(needle)) return false;
      if (filter === 'all') return true;
      const summary = summaryOf(row.id);
      const practices = summary?.practice.count ?? 0;
      if (filter === 'practicing') return practices > 0;
      if (filter === 'not-practicing') return practices === 0;
      return !summary?.lastSeen;
    }).sort((a, b) => {
      const sa = summaryOf(a.id), sb = summaryOf(b.id);
      const wa = sa ? riskOf(sa).weight : 3, wb = sb ? riskOf(sb).weight : 3;
      if (wa !== wb) return wb - wa;
      const la = sa?.lastSeen ? Date.parse(sa.lastSeen) : 0, lb = sb?.lastSeen ? Date.parse(sb.lastSeen) : 0;
      return lb - la;
    });
  }, [rows, activity, filter, query]);

  const practiceCell = (p: Summary) => p.practice.count === 0 ? <span className="muted">Sin práctica</span> : <>
    <strong>{p.practice.count}</strong> · última {date(p.practice.last)}
    <span className="sub">media {p.practice.average}/100 · mejor {p.practice.best}/100</span>
  </>;
  const focusCell = (p: Summary) => {
    const risk = riskOf(p);
    const weak = weakestOf(p);
    return <>
      <span className={risk.tone === 'ok' ? 'status ok' : risk.tone === 'warn' ? 'status bad' : 'status'}>{risk.label}</span>
      <span className="sub">{weak ? `Más bajo: ${weak.label} (${weak.average}/100)` : p.practice.count ? 'Sin notas por criterio' : 'Sin prácticas'}</span>
    </>;
  };
  const trainingCell = (p: Summary) => {
    const done = p.training.modules.length;
    return <>
      {done === 0 ? <span className="muted">Sin ejercicios</span> : <><strong>{done} de {TRAINING_MODULES.length - 1}</strong> ejercicios<span className="sub">último: {date(p.training.lastReview)}</span></>}
      <span className="sub">{p.training.examBest === null ? 'Examen sin corregir' : `Examen ${p.training.examBest}/100 · ${p.training.examPassed ? 'superado' : 'no superado'}`}</span>
    </>;
  };

  return <section aria-label="Alumnas">
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {!available && <div className="alert error" role="alert"><span>No se pudo leer la actividad de las alumnas ahora mismo: las columnas de práctica y formación están <strong>sin datos</strong>, no en cero. La lista de acceso sigue siendo válida.</span></div>}
    {notice && <div className="auth-note" role="status" style={{ marginBottom: 20 }}>{notice}</div>}
    <form className="search-panel admin-toolbar" onSubmit={invite} style={{ marginBottom: 28 }}>
      <label className="grow" htmlFor="student-invite">Invitar a una alumna<input id="student-invite" type="email" required placeholder="nombre@correo.com" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <button className="primary" disabled={!email}><UserPlus size={16} /> Enviar invitación</button></form>
    <p className="card-meta">Acceden en <strong>/alumna</strong>. Los vídeos no se guardan: cada alumna pone el enlace a su propio Drive. La actividad se registra solo cuando entra con su cuenta; nunca se guarda lo que escribe.</p>

    {totals && available && <div className="stat-strip" style={{ marginTop: 20 }}>
      <span><strong>{totals.students}</strong>alumnas</span>
      <span><strong>{totals.active}</strong>activas</span>
      <span><strong>{totals.entered7}</strong>entraron · 7 días</span>
      <span><strong>{totals.practiced7}</strong>practicaron · 7 días</span>
      <span><strong>{totals.practiced ?? '—'}</strong>con práctica · {windowDays} días</span>          <span><strong>{totals.examPassed}</strong>examen superado · {windowDays} días</span>
      {totals.neverEntered > 0 && <span><strong>{totals.neverEntered}</strong>nunca han entrado</span>}
    </div>}

    {/* Lectura de equipo: sumas ponderadas de lo mismo que ve cada alumna. Sin
        prácticas no se pinta el bloque en vez de enseñar ceros vacíos. */}
    {team && available && <div className="stat-strip team-strip">
      <span><strong>{team.practiceAverage ?? '—'}</strong>media del equipo</span>
      <span><strong>{team.weakest?.average ?? '—'}</strong>{team.weakest ? `criterio más débil: ${team.weakest.label}` : 'criterio más débil: sin notas'}</span>
      <span><strong>{team.inStreak || '—'}</strong>en racha (2+ días)</span>
      <span><strong>{team.practiceTotal || '—'}</strong>prácticas registradas</span>
      <span><strong>{team.needsHelp || '—'}</strong>necesitan ayuda</span>
    </div>}

    {team && available && team.practiceTotal > 0 && <div className="progress-columns">
      <article className="progress-card">
        <div className="card-head"><h3><TrendingUp size={16} /> Evolución del equipo</h3><span className="status">por semana</span></div>
        {team.weeks.length ? <>
          <WeekBars weeks={team.weeks} />
          <p className="card-meta">Nota media de las prácticas de todo el equipo; debajo, cuántas se hicieron. Las semanas sin práctica no se rellenan.</p>
        </> : <p className="card-meta">Sin semanas con práctica en esta ventana.</p>}
      </article>
      <article className="progress-card">
        <div className="card-head"><h3><Target size={16} /> Dónde se atasca el equipo</h3><span className="status">media por criterio</span></div>
        {team.axes.length ? <>
          <AxisBars axes={[...team.axes].sort((a, b) => a.average - b.average).slice(0, 4).map(axis => ({ id: axis.id, label: axis.label, average: axis.average, count: axis.practices }))} />
          <p className="card-meta">Los criterios más bajos del conjunto, con su media ponderada por número de prácticas.{team.weakestScenario ? ` La situación con peor media es «${scenarioTitle(team.weakestScenario.id)}» (${team.weakestScenario.average}/100 en ${team.weakestScenario.count}).` : ''}</p>
        </> : <p className="card-meta">Todavía no hay notas por criterio: las prácticas anteriores a la versión con desglose no las guardaban.</p>}
      </article>
    </div>}

    <div className="roster-toolbar">
      <label className="roster-search">Buscar alumna<span className="roster-search-input"><Search size={14} aria-hidden="true" /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="email" /></span></label>
      <div className="filter-chips" role="group" aria-label="Filtrar alumnas">
        {FILTERS.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} disabled={!available && item.id !== 'all'} title={!available && item.id !== 'all' ? 'Sin datos de actividad ahora mismo' : undefined} onClick={() => setFilter(item.id)}>{item.label}{item.id === 'all' ? ` · ${rows.length}` : ''}</button>)}
      </div>
      <div className="roster-actions">
        <div className="filter-chips" role="group" aria-label="Periodo de la actividad">
          {WINDOWS.map(value => <button key={value} type="button" aria-pressed={windowDays === value} onClick={() => setWindowDays(value)}>{value} días</button>)}
        </div>
        <button type="button" onClick={load} disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />} Actualizar</button>
      </div>
    </div>

    {busy ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p> : !rows.length ? <div className="empty"><h3>Aún no hay alumnas invitadas.</h3></div> : !visible.length ? <div className="empty"><h3>Ninguna alumna con ese filtro.</h3><p>Prueba otra búsqueda o vuelve a «Todas»; aquí solo se ocultan filas, no se borra nada.</p></div> : <div className="table-wrap roster-wrap"><table className="data-table roster-table">
      <thead><tr><th scope="col">Alumna</th><th scope="col">Estado</th><th scope="col">Práctica · {windowDays} días</th><th scope="col">Formación · {windowDays} días</th><th scope="col">Foco</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
      <tbody>{visible.map(r => {
        const mine = activity.find(item => item.student.id === r.id);
        const s = mine?.summary;
        return <tr key={r.id}>
          <td className="primary-cell" data-label="Alumna"><strong>{r.email}</strong>
            {r.invited_by && <span>invitada por {r.invited_by}</span>}
            <span>{s?.lastSeen ? `Última entrada: ${dateTime(s.lastSeen)}` : 'Sin actividad: nunca ha entrado'}</span>
            <span>Alta: {new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(r.created_at))}</span>
          </td>
          <td data-label="Estado"><span className={r.status === 'active' ? 'status ok' : r.status === 'paused' ? 'status bad' : 'status'}>{LABEL[r.status]}</span></td>
          <td data-label="Práctica">{!available ? <span className="muted">Sin datos</span> : s ? practiceCell(s) : <span className="muted">Sin actividad</span>}{available && s?.streak ? <span className="sub">racha: {s.streak} {s.streak === 1 ? 'día seguido' : 'días seguidos'}</span> : null}</td>
          <td data-label="Formación">{!available ? <span className="muted">Sin datos</span> : s ? trainingCell(s) : <span className="muted">Sin actividad</span>}</td>
          <td data-label="Foco">{!available ? <span className="muted">Sin datos</span> : s ? focusCell(s) : <span className="muted">Sin actividad</span>}</td>
          <td data-label="Acciones"><div className="row-actions">
            {available && mine && <button onClick={() => setDetail(mine)} aria-label={`Ver actividad de ${r.email}`}>Ver actividad</button>}
            <button onClick={() => void toggle(r)} aria-label={`${r.status === 'paused' ? 'Reactivar' : 'Pausar'} a ${r.email}`}>{r.status === 'paused' ? <Play size={14} /> : <Pause size={14} />} {r.status === 'paused' ? 'Reactivar' : 'Pausar'}</button>
            {owner && <button onClick={() => void remove(r)} aria-label={`Dar de baja a ${r.email}`}><Trash2 size={14} /> Baja</button>}
          </div></td></tr>;
      })}</tbody></table></div>}
    {truncated && available && <p className="card-meta" style={{ marginTop: 12 }}>Hay más movimientos de los que caben en esta vista: las cifras pueden quedarse cortas.</p>}
    {!busy && rows.length > 0 && <p className="card-meta" style={{ marginTop: 12 }}>«Sin actividad» significa que no hay señales guardadas en la ventana; no es una alumna suspendida ni una nota. La lista se ordena por quien necesita una mirada antes (sin entrar, sin practicar, una semana sin practicar), nunca por nota. Las entradas se agrupan cada 10 minutos. {totals?.neverPracticed ? `${totals.neverPracticed} de ${totals.students} no han practicado todavía.` : ''}</p>}

    <dialog open={Boolean(detail)} aria-label={detail ? `Actividad de ${detail.student.email}` : 'Actividad'}>
      {detail && (() => {
        const axes = detail.summary.axes ?? [];
        const weeks = detail.summary.weeks ?? [];
        const scenarios = detail.summary.scenarios ?? [];
        const practiceEvents = detail.recent.filter(event => event.kind === 'practice');
        const graded = practiceEvents.filter(event => event.score !== null);
        return <div className="detail">
          <div className="detail-top">
            <div><span className="eyebrow">ACTIVIDAD · ÚLTIMOS {windowDays} DÍAS</span><h2 style={{ margin: '8px 0 4px' }}>{detail.student.email}</h2>
              <p className="card-meta">{detail.summary.lastSeen ? `Última entrada: ${dateTime(detail.summary.lastSeen)}` : 'Nunca ha entrado con su cuenta.'}</p></div>
            <button className="icon-button" aria-label="Cerrar actividad" onClick={() => setDetail(null)}><X size={20} /></button>
          </div>
          <div className="stat-strip">
            <span><strong>{detail.summary.sessions || '—'}</strong>entradas</span>
            <span><strong>{detail.summary.practice.count || '—'}</strong>prácticas</span>
            <span><strong>{detail.summary.practice.average ?? '—'}</strong>media</span>
            <span><strong>{detail.summary.practice.best ?? '—'}</strong>mejor práctica</span>
            <span><strong>{detail.summary.streak || '—'}</strong>días seguidos</span>
            <span><strong>{detail.summary.training.examBest ?? '—'}</strong>examen</span>
          </div>
          <div className="progress-columns">
            <article className="progress-card">
              <div className="card-head"><h3><MessageSquare size={16} /> Práctica</h3><span className="status">{detail.summary.practice.count ? `${detail.summary.practice.count} terminadas` : 'sin prácticas'}</span></div>
              {detail.summary.practice.count === 0 ? <p className="card-meta">Sin conversaciones terminadas con feedback.</p> : <>
                <p className="card-meta">Última: {dateTime(detail.summary.practice.last)}</p>
                <p className="card-meta">Media {detail.summary.practice.average}/100 · mejor {detail.summary.practice.best}/100</p>
                <p className="card-meta">Notas estimadas por rúbrica; no son una evaluación oficial ni se comparan entre alumnas.</p>
              </>}
            </article>
            <article className="progress-card">
              <div className="card-head"><h3><GraduationCap size={16} /> Formación</h3><span className="status">{detail.summary.training.modules.length} de {TRAINING_MODULES.length - 1}</span></div>
              {detail.summary.training.modules.length === 0 ? <p className="card-meta">Sin ejercicios revisados.</p> : <ul className="progress-modules">
                {detail.summary.training.modules.map(id => <li key={id} data-done="true"><span aria-hidden="true">✓</span>{moduleTitle(id)}<em>practicado</em></li>)}
              </ul>}
              <p className="card-meta">{detail.summary.training.examBest === null ? 'Examen sin corregir.' : `Mejor examen: ${detail.summary.training.examBest}/100 · ${detail.summary.training.examPassed ? 'superado' : 'no superado'} · ${date(detail.summary.training.examLast)}`}</p>
            </article>
          </div>
          <div className="progress-columns">
            <article className="progress-card">
              <div className="card-head"><h3><Target size={16} /> Competencias</h3><span className="status">media por criterio</span></div>
              {axes.length ? <><CompetenceRadar axes={axes} name={detail.student.email} /><AxisBars axes={axes} /></> : <p className="card-meta">{detail.summary.practice.count ? 'Sus prácticas anteriores a esta versión no guardaban la nota de cada criterio; las nuevas sí.' : 'Sin prácticas con desglose por criterio.'}</p>}
            </article>
            <article className="progress-card">
              <div className="card-head"><h3><TrendingUp size={16} /> Evolución</h3><span className="status">por semana</span></div>
              {weeks.length ? <WeekBars weeks={weeks} /> : <p className="card-meta">Sin semanas con práctica en la ventana.</p>}
            </article>
          </div>
          <h3 className="section-title">Situaciones practicadas</h3>
          {!scenarios.length ? <p className="card-meta">Sin prácticas registradas en la ventana.</p> : <div className="table-wrap"><table className="data-table progress-table">
            <thead><tr><th scope="col">Situación</th><th scope="col" className="num">Veces</th><th scope="col" className="num">Media</th><th scope="col">Última</th></tr></thead>
            <tbody>{scenarios.map(item => <tr key={item.id}><td>{scenarioTitle(item.id)}</td><td className="num">{item.count}</td><td className="num">{item.average ?? '—'}</td><td>{date(item.last)}</td></tr>)}</tbody></table></div>}
          <h3 className="section-title">Historial de prácticas</h3>
          {!practiceEvents.length ? <p className="card-meta">Sin conversaciones terminadas con feedback.</p> : <div className="table-wrap"><table className="data-table progress-table">
            <thead><tr><th scope="col">Cuándo</th><th scope="col">Situación</th><th scope="col" className="num">Nota</th><th scope="col">Lectura</th></tr></thead>
            <tbody>{practiceEvents.map(event => <tr key={event.id}><td>{dateTime(event.created_at)}</td><td>{scenarioTitle(event.ref)}</td><td className="num">{event.score ?? '—'}</td><td>{event.score === null ? <span className="muted">sin nota</span> : <span className="status" data-band={band(event.score)}>{bandWord(event.score)}</span>}</td></tr>)}</tbody></table></div>}
          <h3 className="section-title">Movimientos recientes</h3>
          {!detail.recent.length ? <p className="card-meta">Sin movimientos en la ventana.</p> : <div className="table-wrap"><table className="data-table">
            <thead><tr><th scope="col">Cuándo</th><th scope="col">Qué</th><th scope="col" className="num">Resultado</th></tr></thead>
            <tbody>{detail.recent.slice(0, 14).map(event => <tr key={event.id}><td>{dateTime(event.created_at)}</td><td>{eventLabel(event)}</td><td className="num">{eventResult(event)}</td></tr>)}</tbody></table></div>}
          <p className="card-meta" style={{ marginTop: 12 }}>Solo señales de uso: entradas, prácticas con feedback y sus notas, ejercicios revisados y examen. No se guarda el texto de la alumna. {graded.length === 0 && detail.summary.practice.count > 0 ? 'La media no incluye prácticas sin nota.' : ''}</p>
        </div>;
      })()}
    </dialog>
  </section>;
}
