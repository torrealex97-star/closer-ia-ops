'use client';
import type { AxisStat, WeekStat } from '../lib/studentActivity';

// Barras de progreso compartidas por el panel de la alumna y el de la
// coordinadora. La nota va siempre escrita al lado: el color acompaña, no
// informa solo. Un eje sin nota se pinta «—» con su motivo, nunca un 0.

export type Band = 'alto' | 'medio' | 'bajo';
export const band = (score: number): Band => score >= 70 ? 'alto' : score >= 40 ? 'medio' : 'bajo';
const weekLabel = (start: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  .format(new Date(`${start}T00:00:00.000Z`));

export function AxisBars({ axes }: { axes: AxisStat[] }) {
  return <ul className="progress-axes">
    {axes.map(axis => <li key={axis.id}>
      <div className="progress-axis-top">
        <span>{axis.label}</span>
        <b data-band={band(axis.average)}>{axis.average}<small>/100</small></b>
      </div>
      <div className="progress-bar" role="img" aria-label={`${axis.label}: ${axis.average} de 100, media de ${axis.count} ${axis.count === 1 ? 'práctica' : 'prácticas'}`}>
        <i data-band={band(axis.average)} style={{ width: `${axis.average}%` }} />
      </div>
      <small>{axis.count} {axis.count === 1 ? 'práctica' : 'prácticas'} con este criterio</small>
    </li>)}
  </ul>;
}

// Radar de competencias: la misma media por criterio que las barras, en una
// forma que se lee de un vistazo. No sustituye a las barras (que llevan la
// cifra escrita): las acompaña, y con menos de tres criterios no se pinta
// porque una figura de dos puntas no informa de nada.
export function CompetenceRadar({ axes, name }: { axes: AxisStat[]; name?: string }) {
  if (axes.length < 3) return null;
  const size = 260, center = size / 2, radius = 82;
  const point = (index: number, value: number) => {
    const angle = (Math.PI * 2 * index) / axes.length - Math.PI / 2;
    const distance = (Math.max(0, Math.min(100, value)) / 100) * radius;
    return { x: center + Math.cos(angle) * distance, y: center + Math.sin(angle) * distance, angle };
  };
  const polygon = axes.map((axis, index) => point(index, axis.average)).map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const rings = [25, 50, 75, 100];
  const summary = axes.map(axis => `${axis.label}: ${axis.average} de 100`).join(' · ');
  return <figure className="progress-radar">
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${name ? `${name}: ` : ''}radar de competencias. ${summary}`}>
      <title>{`Radar de competencias. ${summary}`}</title>
      {rings.map(ring => <circle key={ring} cx={center} cy={center} r={(radius * ring) / 100} className="progress-radar-ring" />)}
      {axes.map((axis, index) => {
        const edge = point(index, 100);
        return <line key={axis.id} x1={center} y1={center} x2={edge.x} y2={edge.y} className="progress-radar-ring" />;
      })}
      <polygon points={polygon} className="progress-radar-area" />
      {axes.map((axis, index) => {
        const dot = point(index, axis.average);
        const text = point(index, 118);
        const anchor = Math.abs(text.x - center) < 6 ? 'middle' : text.x > center ? 'start' : 'end';
        return <g key={axis.id}>
          <circle cx={dot.x} cy={dot.y} r={3} className="progress-radar-dot" />
          <text x={text.x} y={text.y} textAnchor={anchor} className="progress-radar-label">{axis.label}</text>
          <text x={text.x} y={text.y + 11} textAnchor={anchor} className="progress-radar-value">{axis.average}</text>
        </g>;
      })}
    </svg>
    <figcaption className="card-meta">Media por criterio de tus prácticas. Las barras de abajo llevan el mismo dato escrito.</figcaption>
  </figure>;
}

export function WeekBars({ weeks }: { weeks: WeekStat[] }) {
  return <ul className="progress-weeks">
    {weeks.map(week => <li key={week.start} className="progress-week">
      <div className="progress-week-bar" aria-hidden="true">
        <i data-band={week.average === null ? 'bajo' : band(week.average)} style={{ height: `${week.average ?? 3}%` }} />
      </div>
      <b>{week.average ?? '—'}</b>
      <span>{weekLabel(week.start)}</span>
      <small>{week.count} {week.count === 1 ? 'práctica' : 'prácticas'}</small>
    </li>)}
  </ul>;
}
