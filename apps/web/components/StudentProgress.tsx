'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Award, BarChart3, CalendarCheck, GraduationCap, LoaderCircle, MessageSquare, RefreshCcw, Target, TrendingUp } from 'lucide-react';
import { TRAINING_MODULES } from './trainingContent';
import { PRACTICE_SCENARIOS } from './practiceScenarios';
import { AxisBars, CompetenceRadar, WeekBars, band } from './ProgressBars';
import { WEEK_GOAL } from './practiceAxes';

// «Mi progreso»: señales de uso guardadas por el servidor cuando hay sesión.
// Un hueco no es un cero: sin práctica o sin examen se escribe «—» y el motivo;
// nunca se rellenan cifras de ejemplo ni se comparan notas entre alumnas.
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
  thisWeek?: { count: number; average: number | null };
};
// La ventana manda en las cifras; `lifetime` (sin ventana) manda en racha y logros:
// cambiar el periodo no debe retirar un logro ya conseguido.
type Progress = Summary & { windowDays: number; recent: EventRow[]; lifetime?: Summary; truncated?: boolean };

const WINDOWS = [7, 30, 90];
const date = (value: string | null) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(value)) : '—';
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
const moduleTitle = (id: string) => TRAINING_MODULES.find(item => item.id === id)?.title ?? id;
const scenarioTitle = (id: string | null) => PRACTICE_SCENARIOS.find(item => item.id === id)?.title ?? 'Práctica';
const bandWord = (score: number) => score >= 70 ? 'sólido' : score >= 40 ? 'en progreso' : 'a mejorar';

function label(event: EventRow) {
  if (event.kind === 'session') return 'Entrada a tu espacio';
  if (event.kind === 'practice') return `Práctica: ${scenarioTitle(event.ref)}`;
  if (event.kind === 'training_review') return `Formación: ${moduleTitle(event.ref ?? '')}`;
  return 'Examen de egreso';
}
function result(event: EventRow) {
  if (event.kind === 'training_exam') return `${event.score ?? '—'}/100 · ${event.detail.passed === true ? 'superado' : 'no superado'}`;
  if (event.kind === 'practice') return event.score === null ? 'sin nota' : `${event.score}/100 · estimación`;
  if (event.kind === 'training_review') return typeof event.detail.met === 'number' && typeof event.detail.total === 'number' ? `${event.detail.met}/${event.detail.total} criterios` : '';
  return '';
}

export default function StudentProgress() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  // Cambiar de periodo rápido podía pintar la respuesta vieja encima de la nueva.
  const seq = useRef(0);

  const load = useCallback(() => {
    const id = ++seq.current;
    setBusy(true);
    fetch(`/api/student/progress?days=${days}`).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'No se pudo leer tu progreso.');
      if (id !== seq.current) return;
      setData(body.progress as Progress); setError('');
    }).catch((err: Error) => { if (id === seq.current) setError(err.message); })
      .finally(() => { if (id === seq.current) setBusy(false); });
  }, [days]);
  useEffect(load, [load]);

  const header = <>
    <div className="card-head" style={{ marginBottom: 4 }}>
      <div><span className="eyebrow">TU PROGRESO</span><h2>Lo que ya has practicado.</h2></div>
      <BarChart3 size={22} strokeWidth={1.4} aria-hidden="true" />
    </div>
    <p className="card-meta">Solo se registra si entras con tu cuenta. No guardamos lo que escribes en la sala ni en los ejercicios.</p>
    <div className="progress-toolbar">
      <div className="filter-chips" role="group" aria-label="Periodo del progreso">
        {WINDOWS.map(value => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}>{value} días</button>)}
      </div>
      <small className="muted">Las notas son estimaciones de la rúbrica y no se comparan entre alumnas.</small>
    </div>
  </>;

  if (busy) return <section aria-label="Mi progreso" className="search-panel">{header}<p className="muted"><LoaderCircle size={14} className="spin" /> Cargando tu progreso…</p></section>;
  if (error) return <section aria-label="Mi progreso" className="search-panel">{header}
    <div className="alert error" role="alert"><span>{error}</span></div>
    <button type="button" onClick={load}><RefreshCcw size={14} /> Reintentar</button>
  </section>;
  if (!data) return null;

  const axes = data.axes ?? [];
  const weeks = data.weeks ?? [];
  const scenarios = data.scenarios ?? [];
  // Logros y racha se leen de toda la actividad, no de la ventana elegida.
  const life = data.lifetime ?? data;
  const streak = life.streak ?? 0;
  const practiceHistory = data.recent.filter(event => event.kind === 'practice' && event.score !== null);
  const empty = life.sessions === 0 && life.practice.count === 0 && !life.training.lastReview && life.training.examBest === null;
  const done = new Set(data.training.modules);
  const lifeDone = new Set(life.training.modules);
  const missingModules = TRAINING_MODULES.filter(item => item.id !== 'certificacion' && !lifeDone.has(item.id));
  const weakestAxis = [...axes].sort((a, b) => a.average - b.average)[0];
  const week = data.thisWeek ?? { count: 0, average: null };
  const weekPct = Math.min(100, Math.round((week.count / WEEK_GOAL) * 100));
  // Siguiente paso: una sola cosa, la que más desbloquea. No es una orden ni
  // una nota: si no hay datos suficientes, se dice y no se inventa un consejo.
  const next = data.practice.count === 0
    ? { title: 'Empieza por una conversación', body: 'Abre la sala de práctica y termina una situación. En cuanto pidas el feedback, todo esto empieza a moverse.' }
    : missingModules.length
      ? { title: `Te falta «${missingModules[0].title}»`, body: 'Es el siguiente ejercicio de la formación. Los módulos no llevan nota: se corrigen por criterios y te dicen qué falta.' }
      : !life.training.examPassed
        ? { title: 'Cierra el examen de egreso', body: life.training.examBest === null
            ? 'Todavía no lo has corregido. Son seis preguntas únicas y necesitas 85 para superarlo.'
            : `Tu mejor nota es ${life.training.examBest}/100 y necesitas 85. Repasa los módulos antes de volver a intentarlo.` }
        : weakestAxis
          ? { title: `Repite lo que más te cuesta: ${weakestAxis.label}`, body: `Vas por ${weakestAxis.average}/100 en ese criterio (${weakestAxis.count} ${weakestAxis.count === 1 ? 'práctica' : 'prácticas'}). Una práctica nueva en la misma situación te dará la comparación.` }
          : { title: 'Sigue practicando', body: 'Aún no hay suficientes notas por criterio para decirte qué te frena. Con una práctica más aparecerá aquí.' };
  const weakestScenario = scenarios.filter(item => item.average !== null).sort((a, b) => (a.average ?? 100) - (b.average ?? 100))[0];
  const achievements = [
    { id: 'first', label: 'Primera práctica', hint: 'Termina una conversación y pide feedback.', done: life.practice.count >= 1 },
    { id: 'five', label: 'Cinco prácticas', hint: 'Repite hasta sumar cinco conversaciones.', done: life.practice.count >= 5 },
    { id: 'streak', label: 'Tres días seguidos', hint: 'Practica en días consecutivos.', done: streak >= 3 },
    { id: 'training', label: 'Formación completa', hint: `Revisa los ${TRAINING_MODULES.length - 1} ejercicios.`, done: missingModules.length === 0 },
    { id: 'exam', label: 'Examen superado', hint: 'Corrige el examen y llega a 85.', done: life.training.examPassed },
  ];

  return <section aria-label="Mi progreso" className="search-panel">
    {header}

    <div className="stat-strip">
      <span><strong>{data.lastSeen ? date(data.lastSeen) : '—'}</strong>última entrada{!data.lastSeen && ' · aún sin actividad'}</span>
      <span><strong>{data.sessions || '—'}</strong>entradas</span>
      <span><strong>{data.practice.count || '—'}</strong>prácticas terminadas</span>
      <span><strong>{data.practice.average ?? '—'}</strong>media de práctica</span>
      <span><strong>{data.practice.best ?? '—'}</strong>mejor nota de práctica</span>
      <span><strong>{streak || '—'}</strong>{streak > 0 ? 'días seguidos practicando' : 'racha de práctica'}</span>
      <span><strong>{data.training.examBest ?? '—'}</strong>mejor examen{data.training.examBest !== null && (data.training.examPassed ? ' · superado' : ' · no superado')}</span>
    </div>

    {empty ? <div className="empty">
      <Target size={30} strokeWidth={1.3} />
      <h3>Aún no hay actividad en tu cuenta.</h3>
      <p>Entra a la formación o a la sala de práctica desde la pestaña de oportunidades y vuelve aquí: tus ejercicios y tu examen aparecerán en este panel.</p>
    </div> : <>
      <div className="progress-goal">
        <div className="progress-goal-top">
          <span>Esta semana</span>
          <span>{week.count > WEEK_GOAL
            ? <><strong>{week.count}</strong> prácticas · objetivo {WEEK_GOAL}</>
            : <><strong>{week.count}</strong> de {WEEK_GOAL} prácticas</>}{week.average !== null ? ` · media ${week.average}/100` : ''}</span>
        </div>
        <div className="progress-goal-bar" role="img" aria-label={`${week.count} de ${WEEK_GOAL} prácticas esta semana`}><i style={{ width: `${weekPct}%` }} /></div>
        <small className="card-meta" style={{ margin: 0 }}>{week.count === 0 ? 'Aún no has practicado esta semana. La semana empieza el lunes.' : week.count >= WEEK_GOAL ? 'Objetivo semanal cubierto; lo que hagas de más suma igual.' : `Te ${WEEK_GOAL - week.count === 1 ? 'queda 1 práctica' : `quedan ${WEEK_GOAL - week.count} prácticas`} para la referencia de la semana.`}</small>
      </div>

      <div className="progress-next">
        <span className="eyebrow">SIGUIENTE PASO</span>
        <p><strong>{next.title}.</strong> {next.body}</p>
      </div>

      <div className="progress-columns">
        <article className="progress-card">
          <div className="card-head"><h3><MessageSquare size={16} /> Sala de práctica</h3><span className="status">{data.practice.count ? `${data.practice.count} terminadas` : 'sin prácticas'}</span></div>
          {data.practice.count === 0 ? <p className="card-meta">Cuando termines una conversación y pidas el feedback, se contará aquí. La nota es una estimación de la rúbrica, no una evaluación oficial.</p> : <>
            <p className="card-meta">Última: {dateTime(data.practice.last)}</p>
            <p className="card-meta">Media de tus prácticas: <strong>{data.practice.average}/100</strong> · mejor: <strong>{data.practice.best}/100</strong></p>
            <p className="card-meta">Solo entran las conversaciones con feedback; abrir la sala no cuenta como práctica.</p>
          </>}
        </article>
        <article className="progress-card">
          <div className="card-head"><h3><GraduationCap size={16} /> Formación</h3><span className="status">{done.size} de {TRAINING_MODULES.length - 1} ejercicios</span></div>
          <ul className="progress-modules">
            {TRAINING_MODULES.filter(item => item.id !== 'certificacion').map(item => <li key={item.id} data-done={done.has(item.id)}>
              <span aria-hidden="true">{done.has(item.id) ? '✓' : '·'}</span>{item.title}
              <em>{done.has(item.id) ? 'practicado' : 'sin practicar'}</em>
            </li>)}
          </ul>
          <p className="card-meta">
            {data.training.examBest === null
              ? 'Examen: todavía no lo has corregido.'
              : `Examen: ${data.training.examBest}/100 · ${data.training.examPassed ? 'superado' : 'no superado'} · ${date(data.training.examLast)}`}
          </p>
          {data.training.examBest !== null && <p className="card-meta">El examen mide seis preguntas únicas; no es una certificación oficial.</p>}
        </article>
      </div>

      <div className="progress-columns">
        <article className="progress-card">
          <div className="card-head"><h3><Target size={16} /> Tus competencias</h3><span className="status">media por criterio</span></div>
          {axes.length ? <>
            <CompetenceRadar axes={axes} name="Tus competencias" />
            <AxisBars axes={axes} />
            <p className="card-meta">Media de tus prácticas en la ventana. Cada práctica nueva añade su nota a cada criterio.</p>
          </> : <p className="card-meta">
            {data.practice.count
              ? 'Tus prácticas anteriores a esta versión no guardaban la nota de cada criterio; las nuevas sí aparecerán aquí.'
              : 'Cuando termines una práctica con feedback verás la media de cada criterio de la rúbrica.'}
          </p>}
        </article>
        <article className="progress-card">
          <div className="card-head"><h3><TrendingUp size={16} /> Tu evolución</h3><span className="status">por semana</span></div>
          {weeks.length ? <>
            <WeekBars weeks={weeks} />
            <p className="card-meta">Nota media de las prácticas de cada semana; debajo, cuántas hiciste. Las semanas sin práctica no se rellenan.</p>
          </> : <p className="card-meta">Aún no hay semanas con práctica en esta ventana. Cuando hagas la primera, aparecerá aquí.</p>}
        </article>
      </div>

      <div className="progress-focus">
        <span className="eyebrow">DÓNDE TE ATASCAS</span>
        {weakestAxis || weakestScenario ? <>
          <p>
            {weakestAxis && <>Tu criterio más bajo es <strong>{weakestAxis.label}</strong> ({weakestAxis.average}/100 en {weakestAxis.count} {weakestAxis.count === 1 ? 'práctica' : 'prácticas'}).</>}
            {weakestAxis && weakestScenario && ' '}
            {weakestScenario && <>La situación que más te cuesta es <strong>{scenarioTitle(weakestScenario.id)}</strong> (media {weakestScenario.average}/100 en {weakestScenario.count} {weakestScenario.count === 1 ? 'vez' : 'veces'}).</>}
          </p>
          <p className="card-meta">Es la lectura de tus propias notas, no una evaluación oficial. Repite esa situación en la sala de práctica para comparar la próxima vez.</p>
        </> : <p className="card-meta">Con una práctica más podremos decirte qué criterio te frena antes. Todavía no hay suficientes notas.</p>}
      </div>

      <h3 className="section-title" style={{ fontSize: 16 }}><Award size={16} /> Logros</h3>
      <p className="card-meta">Se calculan con toda tu actividad: cambiar el periodo de arriba no retira un logro.</p>
      <ul className="progress-achievements">
        {achievements.map(item => <li key={item.id} data-done={item.done}>
          <span aria-hidden="true">{item.done ? '✓' : '·'}</span>
          <strong>{item.label}</strong>
          <small>{item.done ? 'conseguido' : item.hint}</small>
        </li>)}
      </ul>

      <h3 className="section-title" style={{ fontSize: 16 }}><CalendarCheck size={16} /> Historial de prácticas</h3>
      {!practiceHistory.length ? <p className="card-meta">Sin prácticas con nota en estos {data.windowDays} días.</p> : <div className="table-wrap"><table className="data-table progress-table">
        <thead><tr><th scope="col">Cuándo</th><th scope="col">Situación</th><th scope="col" className="num">Nota</th><th scope="col">Lectura</th></tr></thead>
        <tbody>{practiceHistory.map(event => <tr key={event.id}>
          <td>{dateTime(event.created_at)}</td>
          <td>{scenarioTitle(event.ref)}</td>
          <td className="num">{event.score}/100</td>
          <td><span className="status" data-band={band(event.score ?? 0)}>{bandWord(event.score ?? 0)}</span></td>
        </tr>)}</tbody></table></div>}

      <h3 className="section-title" style={{ fontSize: 16 }}><CalendarCheck size={16} /> Actividad reciente</h3>
      {!data.recent.length ? <p className="card-meta">Sin movimientos en estos {data.windowDays} días.</p> : <div className="table-wrap"><table className="data-table">
        <thead><tr><th scope="col">Cuándo</th><th scope="col">Qué</th><th scope="col" className="num">Resultado</th></tr></thead>
        <tbody>{data.recent.map(event => <tr key={event.id}>
          <td>{dateTime(event.created_at)}</td>
          <td>{label(event)}</td>
          <td className="num">{result(event)}</td>
        </tr>)}</tbody></table></div>}
      {data.truncated && <p className="card-meta" style={{ marginTop: 12 }}>Hay más actividad de la que cabe en esta vista: las cifras pueden quedarse cortas en un periodo muy largo.</p>}
      {data.practice.count > 0 && <p className="card-meta" style={{ marginTop: 12 }}><AlertTriangle size={12} aria-hidden="true" /> Las notas son estimaciones por rúbrica; no se comparan ni se publican.</p>}
    </>}
  </section>;
}
