'use client';
import { useMemo } from 'react';
import { MIN_GROUP, NUDGE_LIMIT, funnel, moduleCoverage, needsNudge, scoreBuckets } from '../lib/studentDashboard';
import type { DashStudent, DashSummary } from '../lib/studentDashboard';
import { TRAINING_MODULES } from './trainingContent';

// Panel de coordinación (adaptado del «Panel del manager» de closer-ai-coach, sin sus datos de demostración): qué decisión
// toma la coordinadora: a quién escribir hoy y qué parte de la formación se está saltando. Cada gráfico lleva su tabla.
const MODULE_LABELS: Record<string, string> = Object.fromEntries(TRAINING_MODULES.map(item => [item.id, item.title]));

function Bars({ rows, label }: { rows: { id: string; label: string; count: number; pct: number | null }[]; label: string }) {
  return <>
    <div className="funnel" role="img" aria-label={label}>{rows.map(row => <div className="funnel-row" key={row.id}>
      <span>{row.label}</span>
      <div className="meter" aria-hidden="true"><span style={{ width: `${row.pct ?? 0}%` }} /></div>
      <b>{row.count}{row.pct !== null ? ` · ${row.pct} %` : ''}</b>
    </div>)}</div>
    <details><summary>Ver como tabla</summary><div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Paso</th><th scope="col" className="num">Alumnas</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td className="num">{row.count} ({row.pct === null ? '—' : `${row.pct} %`})</td></tr>)}</tbody></table></div></details>
  </>;
}

export default function StudentActivityDashboard({ students, summaries, days }: { students: DashStudent[]; summaries: Map<string, DashSummary>; days: number }) {
  const data = useMemo(() => ({
    steps: funnel(students, summaries),
    modules: moduleCoverage(students, summaries),
    buckets: scoreBuckets(students, summaries),
    nudges: needsNudge(students, summaries),
  }), [students, summaries]);
  const base = data.steps[0]?.count ?? 0;
  if (!students.length) return null; // la tabla ya dice que aún no hay alumnas
  if (!base) return <div className="coordinator" data-testid="coordinator"><p className="card-meta">— Ninguna alumna tiene el acceso activo (todas están pausadas), así que no hay actividad que resumir.</p></div>;
  return <div className="coordinator" data-testid="coordinator">
    <p className="card-meta">Resumen de los últimos {days} días de las {base} alumnas con acceso (las pausadas no cuentan). Son recuentos reales de su actividad en el portal, no una evaluación.</p>
    <div className="progress-grid">
      <article className="progress-card"><h2>{data.steps[2].count} de {base} han practicado</h2><p className="card-meta">Qué ha hecho cada alumna en los últimos {days} días. Una misma alumna puede contar en varias barras (no es un embudo en orden: puede repasar un módulo sin haber practicado). Porcentajes sobre las {base} con acceso.</p>
        <Bars rows={data.steps} label={`Actividad de las alumnas en ${days} días: ${data.steps.map(step => `${step.label} ${step.count}${step.pct === null ? '' : ` (${step.pct} %)`}`).join(', ')}.`} /></article>
      <article className="progress-card"><h2>Formación por módulo</h2><p className="card-meta">Alumnas que han repasado cada módulo (cualquier fecha dentro del periodo).</p>
        <Bars rows={data.modules.map(item => ({ id: item.ref, label: MODULE_LABELS[item.ref] ?? item.ref, count: item.count, pct: item.pct }))} label={`Alumnas por módulo repasado, sobre ${base} con acceso: ${data.modules.map(item => `${MODULE_LABELS[item.ref] ?? item.ref} ${item.count}${item.pct === null ? '' : ` (${item.pct} %)`}`).join(', ')}.`} /></article>
      <article className="progress-card"><h2>Nota media de práctica</h2>
        {data.buckets ? <><p className="card-meta">Alumnas según su nota media (estimación del modelo, no una evaluación). Porcentajes sobre las que han practicado, no sobre todas.</p>
          <Bars rows={data.buckets} label={`Alumnas por nota media de práctica, sobre las que han practicado: ${data.buckets.map(bucket => `${bucket.label} ${bucket.count} (${bucket.pct} %)`).join(', ')}.`} /></>
          : <p className="card-meta">— Hace falta que al menos {MIN_GROUP} alumnas hayan practicado en el periodo para mostrar la distribución sin señalar a nadie.</p>}</article>
      <article className="progress-card"><h2>{data.nudges.length ? `${data.nudges.length} ${data.nudges.length === 1 ? 'alumna necesita' : 'alumnas necesitan'} un empujón` : 'Quién necesita un empujón'}</h2>
        {data.nudges.length ? <><ul className="plain-list" data-testid="nudges">{data.nudges.slice(0, NUDGE_LIMIT).map(item => <li key={item.id}><strong>{item.email}</strong><br /><small>{item.reason}</small></li>)}</ul>
          {data.nudges.length > NUDGE_LIMIT && <p className="card-meta">Y {data.nudges.length - NUDGE_LIMIT} más: están en la tabla de abajo.</p>}</>
          : <p className="card-meta">Todas las alumnas con acceso han entrado y hecho algo en este periodo.</p>}</article>
    </div>
  </div>;
}
