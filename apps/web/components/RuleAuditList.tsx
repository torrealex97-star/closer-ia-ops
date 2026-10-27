'use client';
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, LoaderCircle, RefreshCcw } from 'lucide-react';

// Auditoría del catálogo: qué ofertas YA aprobadas retiraría hoy la regla, y por qué. Es SOLO LECTURA: no
// cambia ninguna oferta ni gasta cupo. Sirve para revisar lo que aprobó una versión anterior de la regla (o una
// persona) antes de decidir, sin que un barrido automático borre ofertas publicadas por un patrón equivocado.
// Un fallo se muestra como fallo (con reintento), nunca como «0 ofertas que retirar».
type Match = { id: string; source: string; title: string; company: string | null; url: string; editorial_status: string; verified_result: string | null; reviewed_by: string | null; score: number | null; why: string };
type Audit = { scanned: number; matches: Match[]; by_reason: Record<string, number>; truncated: boolean };
const REASON: Record<string, string> = { no_es_oferta: 'Es un listado del portal, no una oferta', enlace_cerrado: 'El enlace ya está cerrado' };
const STATUS: Record<string, string> = { approved: 'Aprobada', published: 'Publicada' };
const REVIEWED: Record<string, string> = { 'auto-reglas': 'por las reglas', 'auto-vigencia': 'por la vigencia automática', 'auto-retira': 'por las reglas' };

export default function RuleAuditList({ onSessionLost }: { onSessionLost: () => void }) {
  const [a, setA] = useState<Audit | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const load = useCallback(() => {
    setBusy(true); setError('');
    fetch('/api/admin/external/audit', { cache: 'no-store' }).then(async r => {
      const d = await r.json().catch(() => ({})) as { detail?: string };
      if (r.status === 401) onSessionLost();
      if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'No se pudo auditar el catálogo.');
      setA(d as Audit);
    }).catch((e: Error) => { setA(null); setError(e.message); }).finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);

  if (error) return <div className="alert error" role="alert" data-testid="rule-audit-error"><span>{error}</span> <button onClick={load} disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />} Reintentar</button></div>;
  if (!a) return <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Auditando el catálogo…</p>;

  const total = a.matches.length;
  return <details className="search-panel" style={{ marginBottom: 16 }} data-testid="rule-audit" open={total > 0}>
    <summary><strong>Auditoría de la regla sobre lo ya aprobado: {total ? `${total} oferta(s) que retiraría` : 'nada que retirar'}</strong>{' '}<span className="card-meta" style={{ margin: 0 }}>({a.scanned} revisada(s))</span></summary>
    <p className="card-meta" style={{ marginTop: 8 }}>
      <strong>Solo lectura:</strong> no cambia ninguna oferta ni gasta cupo. La pasada automática solo mira borradores, así que lo que aprobó una versión anterior de la regla sigue publicado hasta que lo retires a mano.
    </p>
    {a.truncated && <p className="card-meta" data-testid="rule-audit-truncated">Se revisaron {a.scanned} ofertas y quedan más: la lista no está completa y el resto queda para la próxima comprobación.</p>}
    {total === 0
      ? <p className="muted">Ninguna de las {a.scanned} ofertas aprobadas y vivas es un listado de portal ni tiene el enlace cerrado.</p>
      : <div className="table-wrap"><table className="data-table" data-testid="rule-audit-table">
          <caption className="card-meta" style={{ textAlign: 'left' }}>Ofertas ya aprobadas que la regla retiraría, con el motivo</caption>
          <thead><tr><th scope="col">Motivo</th><th scope="col">Oferta</th><th scope="col">Estado</th><th scope="col">Fuente</th><th scope="col" /></tr></thead>
          <tbody>{a.matches.map(m => <tr key={m.id}>
            <td><span className="status bad">{REASON[m.why] ?? m.why}</span></td>
            <td className="primary-cell"><strong>{m.title}</strong><span>{m.company ?? 'Empresa no indicada'}</span></td>
            <td>{STATUS[m.editorial_status] ?? m.editorial_status}{m.reviewed_by ? <span className="sub">{REVIEWED[m.reviewed_by] ?? `por ${m.reviewed_by}`}</span> : null}</td>
            <td>{m.source}</td>
            <td style={{ textAlign: 'right' }}><a href={m.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${m.title}`}><ExternalLink size={14} /></a></td>
          </tr>)}</tbody></table></div>}
    <div className="admin-toolbar" style={{ marginTop: 12 }}>
      <button onClick={load} disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />} Comprobar de nuevo</button>
      <span className="card-meta" style={{ margin: 0 }}>Si alguna no debe estar, selecciónala abajo y pulsa «Retirar»: la auditoría informa, no actúa.</span>
    </div>
  </details>;
}
