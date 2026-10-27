'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCcw } from 'lucide-react';

// Aviso del motor en TODAS las pestañas del panel: si el motor se pausa por cuota o deja de responder, el
// operador lo ve sin abrir «Fuentes» (que es donde estaba escondido), con la causa, desde cuándo se detectó
// y si el correo de aviso ya salió o por qué no. Con el motor bien no pinta nada: un aviso que siempre está
// no se lee.
type Status = 'ok' | 'allowance' | 'timeout' | 'down' | 'unconfigured';
type Report = {
  generated_at: string;
  engine: { configured: boolean; status: Status; detail: string; http_status: number | null; catalog_active: number | null; raw_items: number | null; ms: number; checked_at: string; since: string | null; last_checked_at: string | null; last_checked_by: string | null };
  log: { available: boolean; problem: string | null };
  notify: { key_saved: boolean; to: string[]; blocked: string | null; last: { kind: 'outage' | 'recovery'; at: string; detail: string | null; status: Status } | null };
  decision?: { kind: 'outage' | 'recovery' | null; why: string } | null;
  email?: { attempted: boolean; sent: boolean; to: string[]; detail: string } | null;
  notify_blocked?: string | null;
};

const fmt = (value: string | null) => (value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—');
const TITLE: Partial<Record<Status, string>> = {
  allowance: 'El motor está en pausa por cuota de hosting.',
  timeout: 'El motor no responde a tiempo.',
  down: 'El motor no responde.',
};

export default function EngineAlertBanner({ go }: { go: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/alerts', { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      setReport(await response.json());
      setUnreachable(false);
    } catch { setUnreachable(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function check() {
    setBusy(true); setNote('');
    try {
      const response = await fetch('/api/admin/alerts', { method: 'POST' });
      const data = await response.json().catch(() => null) as (Report & { detail?: string }) | null;
      if (!response.ok) throw new Error(data?.detail ?? 'La comprobación falló.');
      if (data) { setReport(data); setUnreachable(false); }
      setNote(data?.email?.detail ?? data?.notify_blocked ?? 'Comprobación registrada: el motor responde bien.');
    } catch (error) { setNote((error as Error).message); }
    finally { setBusy(false); }
  }

  const status = report?.engine.status;
  const outage = status === 'allowance' || status === 'timeout' || status === 'down';
  if (!report || !outage) return unreachable ? <p className="card-meta engine-alert-unknown">No se pudo comprobar ahora mismo el estado del motor.</p> : null;

  const last = report.notify.last;
  const emailLine = !report.log.available
    ? `Sin aviso por correo mientras no haya historial: ${report.log.problem}`
    : report.notify.blocked
      ? `Aviso por correo desactivado: ${report.notify.blocked}.`
      : last && last.kind === 'outage' && last.status === status
        ? `Aviso enviado a ${report.notify.to.join(', ')} el ${fmt(last.at)}.`
        : 'Aún no se ha enviado el aviso por correo de este estado.';

  return <div className="alert engine-alert" role="region" aria-label="Estado del motor" data-testid="engine-alert">
    <div className="engine-alert-text">
      <strong>{TITLE[status]}</strong>
      <p>{report.engine.detail}{report.engine.http_status ? ` HTTP ${report.engine.http_status}.` : ''}{report.engine.since ? ` Se detectó el ${fmt(report.engine.since)}.` : ''}</p>
      <p className="card-meta" data-testid="engine-alert-email">{emailLine}</p>
      {report.log.available && report.engine.last_checked_at && <p className="card-meta">Última comprobación: {fmt(report.engine.last_checked_at)} ({report.engine.last_checked_by ?? '—'}).</p>}
      {note && <p className="card-meta" role="status" data-testid="engine-alert-note">{note}</p>}
    </div>
    <div className="engine-alert-actions">
      <button onClick={() => void check()} disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />} Comprobar ahora</button>
      <button onClick={go}>Ver en Fuentes</button>
    </div>
  </div>;
}
