'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCcw } from 'lucide-react';
import type { Funnel, FunnelMarket } from '../lib/funnel';

// Embudo por fuente y mercado. Reglas de `dashboard-design`: sin dato = «—» con su causa, error ≠ vacío (con reintentar),
// colores solo por tokens y tabla como representación principal (es un listado comparable, no un gráfico decorativo).
const MARKET_LABEL: Record<FunnelMarket, string> = { ES: 'España', LATAM: 'LATAM', LATAM_DEFECTO: 'LATAM por defecto', US_LATINO: 'EE. UU. / dólares', SIN_MERCADO: 'Sin mercado' };
const WHY_LABEL: Record<string, string> = {
  sin_perfil: 'Sin perfil comercial', sin_mercado: 'Sin mercado', mercado_dudoso: 'Mercado dudoso', banderas_rojas: 'Banderas rojas', oferta_peligrosa: 'Oferta peligrosa',
  oferta_con_avisos: 'Oferta con avisos', score_bajo: 'Puntuación baja', idioma_dudoso: 'Idioma dudoso', tope_diario: 'Tope diario', enlace_cerrado: 'Enlace cerrado', no_es_oferta: 'No es oferta',
};
const nf = new Intl.NumberFormat('es');

export default function FunnelPanel({ onSessionLost }: { onSessionLost: () => void }) {
  const [f, setF] = useState<Funnel | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const load = useCallback(() => {
    setBusy(true); setError('');
    fetch('/api/admin/funnel', { cache: 'no-store' }).then(async r => { const d = await r.json().catch(() => ({})); if (r.status === 401) onSessionLost(); if (!r.ok) throw new Error(d.detail ?? 'No se pudo cargar el embudo.'); setF(d); })
      .catch((e: Error) => { setF(null); setError(e.message); }).finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);

  if (busy && !f) return <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Cargando embudo…</p>;
  if (error || !f) return <div className="alert error" role="alert" data-testid="funnel-error"><span>{error || 'No se pudo cargar el embudo.'}</span> <button onClick={load} disabled={busy}><RefreshCcw size={14} /> Reintentar</button></div>;

  const t = f.totals, nothing = t.new7 + t.approved7 + t.human7 + t.withdrawn7 + t.visible === 0;
  const reasons = Object.entries(t.reasons).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return <details className="search-panel" style={{ marginBottom: 16 }} data-testid="funnel" open={!nothing}>
    <summary><strong>Embudo por fuente y mercado: {nf.format(t.new24)} nuevas en 24 h</strong> <span className="card-meta" style={{ margin: 0 }}>({nf.format(t.new7)} en 7 días · {nf.format(t.visible)} aprobadas y vigentes)</span></summary>
    {f.truncated && <div className="alert error" role="alert" data-testid="funnel-truncated">Hay más filas de las que se pudieron leer: las cifras son parciales y están por debajo de la realidad.</div>}
    {nothing ? <div className="empty" data-testid="funnel-empty"><h3>Sin movimiento en los últimos 7 días.</h3><p className="card-meta">No ha entrado ni se ha decidido ninguna oferta. Esto no significa que las fuentes funcionen: significa que no hay datos. Revisa que no estén pausadas y lanza una recogida.</p></div> : <>
      <div className="stat-strip">
        <span><strong>{nf.format(t.new24)} / {nf.format(t.new7)}</strong>nuevas (24 h / 7 d)</span>
        <span><strong>{nf.format(t.approved24)} / {nf.format(t.approved7)}</strong>aprobadas (24 h / 7 d)</span>
        <span><strong>{nf.format(t.human24)} / {nf.format(t.human7)}</strong>a revisión humana (24 h / 7 d)</span>
        <span><strong>{nf.format(t.withdrawn24)} / {nf.format(t.withdrawn7)}</strong>retiradas por reglas (24 h / 7 d)</span>
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}><table className="data-table" data-testid="funnel-table"><caption className="card-meta" style={{ textAlign: 'left' }}>Por fuente y mercado. «Nuevas» = primera vez vista; «decididas» = fecha de la decisión; «vigentes» = aprobadas y no caducadas ahora (aprox.: la vista de alumna aplica además sus filtros de rol e idioma).</caption>
        <thead><tr><th scope="col">Fuente</th><th scope="col">Mercado</th><th scope="col" className="num">Nuevas 24 h</th><th scope="col" className="num">Nuevas 7 d</th><th scope="col" className="num">Aprobadas 7 d</th><th scope="col" className="num">A humano 7 d</th><th scope="col" className="num">Retiradas 7 d</th><th scope="col" className="num">Vigentes</th></tr></thead>
        <tbody>{f.rows.map(r => <tr key={`${r.source}|${r.market}`}><th scope="row" style={{ fontWeight: 400 }}>{r.source}</th><td>{MARKET_LABEL[r.market]}</td><td className="num">{r.new24}</td><td className="num">{r.new7}</td><td className="num">{r.approved7}</td><td className="num">{r.human7}</td><td className="num">{r.withdrawn7}</td><td className="num">{r.visible}</td></tr>)}</tbody></table></div>
      <div className="table-wrap" style={{ marginTop: 12 }}><table className="data-table" data-testid="funnel-reasons"><caption className="card-meta" style={{ textAlign: 'left' }}>Por qué no llegaron a una alumna (7 días, solo decisiones de las reglas)</caption>
        <thead><tr><th scope="col">Motivo</th><th scope="col" className="num">Ofertas</th></tr></thead>
        <tbody>{reasons.length ? reasons.map(([why, n]) => <tr key={why}><th scope="row" style={{ fontWeight: 400 }}>{WHY_LABEL[why] ?? why}</th><td className="num">{n}</td></tr>) : <tr><td colSpan={2} className="card-meta">Sin descartes ni envíos a revisión con motivo en 7 días.</td></tr>}</tbody></table></div>
      <div className="table-wrap" style={{ marginTop: 12 }}>{f.ingest === null ? <p className="card-meta" data-testid="funnel-ingest-missing">Entradas brutas por fuente: —, no se pudieron leer las ejecuciones de ingesta.</p> :
        <table className="data-table" data-testid="funnel-ingest"><caption className="card-meta" style={{ textAlign: 'left' }}>Entradas brutas por fuente (ejecuciones de ingesta; no distinguen mercado)</caption>
          <thead><tr><th scope="col">Fuente</th><th scope="col" className="num">Recibidas 24 h</th><th scope="col" className="num">Aceptadas 24 h</th><th scope="col" className="num">Recibidas 7 d</th><th scope="col" className="num">Aceptadas 7 d</th></tr></thead>
          <tbody>{f.ingest.length ? f.ingest.map(x => <tr key={x.source}><th scope="row" style={{ fontWeight: 400 }}>{x.source}</th><td className="num">{x.received24}</td><td className="num">{x.accepted24}</td><td className="num">{x.received7}</td><td className="num">{x.accepted7}</td></tr>) : <tr><td colSpan={5} className="card-meta">Sin ejecuciones de ingesta en 7 días.</td></tr>}</tbody></table>}</div>
      <p className="card-meta">Lo que este panel <strong>no puede ver</strong>: lo descartado antes de guardar, los duplicados entre fuentes y cuántas eran visibles en un día pasado (solo se acumula hacia delante). «LATAM por defecto» = español sin ubicación ni importe. El motor de Cloudflare se mide aparte en «Fuentes».</p>
    </>}
  </details>;
}
