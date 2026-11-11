import { ENGINE_STATUS_TEXT, type EngineProbe, type EngineStatus, type NotifyKind, type NotifyStatus, engineBase, isOutage, isPause, probeEngine } from './engineHealth';
import { ORG } from './external';
import { listAdmins, serviceRest } from './supabaseAuth';
import { getSecret, listConnections } from './integrations';

// Aviso del motor: historial de comprobaciones + correo al propietario.
//
// El operador no debe enterarse de que el motor se ha pausado abriendo la pestaña «Fuentes»: el panel lo
// enseña en cualquier pestaña y, si hay clave de Resend guardada, el correo sale solo. Reglas que se
// respetan aquí y se prueban en `tests/admin-auth/enginealert.mjs`:
//   · un mismo estado NO se avisa dos veces; un estado PEOR sí; la recuperación también;
//   · si el aviso anterior no llegó a salir, el siguiente intento lo vuelve a intentar;
//   · sin historial (migración sin aplicar) NO se envía nada, porque sin registro el aviso se repetiría
//     en cada comprobación; se declara en el panel en vez de callarlo;
//   · solo se avisa al PROPIETARIO (lista de operadores) y jamás a una alumna;
//   · una escritura fallida no se cuenta como aviso enviado (se vuelve a intentar en la siguiente pasada).
export const ALERT_TABLE = 'engine_alerts';
export const ALERT_MIGRATION = 'supabase/migrations/20261029_engine_alerts.sql';
const ALERT_SELECT = 'select=id,status,http_status,detail,since,checked_at,checked_by,notified_at,notified_kind,notified_detail';
const EMAIL_TIMEOUT_MS = 15_000;

export type EngineAlertRow = {
  id: string;
  status: EngineStatus;
  http_status: number | null;
  detail: string;
  since: string;
  checked_at: string;
  checked_by: string;
  notified_at: string | null;
  notified_kind: NotifyKind | null;
  notified_detail: string | null;
};

export type AlertDecision = { kind: NotifyKind | null; why: string };
export type EmailOutcome = { attempted: boolean; sent: boolean; to: string[]; detail: string };
export type NotifyInfo = {
  key_saved: boolean;
  to: string[];
  blocked: string | null;
  last: { kind: NotifyKind; at: string; detail: string | null; status: EngineStatus } | null;
};

export type AlertReport = {
  generated_at: string;
  engine: EngineProbe & { since: string | null; last_checked_at: string | null; last_checked_by: string | null };
  log: { available: boolean; problem: string | null };
  notify: NotifyInfo;
  /** Solo en `checkEngine`: qué se registró y qué se envió. */
  recorded: boolean;
  decision: AlertDecision | null;
  email: EmailOutcome | null;
  notify_blocked: string | null;
};

// ── Historial ─────────────────────────────────────────────────────────────────────────────────────────
export type AlertLog = { available: boolean; problem: string | null; rows: EngineAlertRow[] };

export const migrationProblem = () => `Falta aplicar la migración ${ALERT_MIGRATION} en Supabase.`;

export async function readAlertLog(limit = 5): Promise<AlertLog> {
  const response = await serviceRest(`${ALERT_TABLE}?org_id=eq.${ORG}&${ALERT_SELECT}&order=checked_at.desc&limit=${limit}`).catch(() => null);
  if (!response) return { available: false, problem: 'No se pudo contactar con la base para leer el historial del motor.', rows: [] };
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string } | null;
    const missing = response.status === 404 || body?.code === 'PGRST205' || body?.code === '42P01';
    return { available: false, problem: missing ? migrationProblem() : `No se pudo leer el historial del motor (HTTP ${response.status}).`, rows: [] };
  }
  const rows = await response.json().catch(() => null);
  return Array.isArray(rows)
    ? { available: true, problem: null, rows: rows as EngineAlertRow[] }
    : { available: false, problem: 'La lectura del historial del motor no devolvió filas legibles.', rows: [] };
}

// ── Cuándo avisar (función pura: se prueba con la tabla de casos) ─────────────────────────────────────
export function decideNotification(rows: EngineAlertRow[], probe: EngineProbe): AlertDecision {
  if (!probe.configured) return { kind: null, why: 'sin motor configurado no hay nada que vigilar' };
  const prev = rows[0] ?? null;
  if (probe.status === 'ok') {
    return prev && isOutage(prev.status)
      ? { kind: 'recovery', why: 'el motor ha vuelto a responder' }
      : { kind: null, why: 'el motor está bien' };
  }
  if (!prev) return { kind: 'outage', why: 'primera comprobación registrada y el motor no está bien' };
  if (prev.status === probe.status) {
    return prev.notified_kind === 'outage'
      ? { kind: null, why: 'mismo estado que el aviso ya enviado' }
      : { kind: 'outage', why: 'el aviso anterior no llegó a salir' };
  }
  if (isOutage(prev.status)) return { kind: 'outage', why: `el estado ha empeorado (${prev.status} → ${probe.status})` };
  return { kind: 'outage', why: 'el motor ha dejado de responder' };
}

// ── Correo ────────────────────────────────────────────────────────────────────────────────────────────
const panelUrl = (env: NodeJS.ProcessEnv) => (env.ADMIN_PUBLIC_URL ?? 'https://app.womendigitalclosers.com').replace(/\/$/, '');
const clean = (text: unknown) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 160) : '');

export function alertEmail(probe: EngineProbe, kind: NotifyKind, detectedAt: string, panel: string): { subject: string; text: string } {
  const when = new Date(detectedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  if (kind === 'recovery') {
    return {
      subject: '[WDC] El motor vuelve a responder',
      text: [
        'El motor cloud de ofertas vuelve a responder (su catálogo se sirve otra vez).',
        'No hace falta que hagas nada; este aviso cierra el anterior.',
        `Panel: ${panel}/admin`,
      ].join('\n'),
    };
  }
  const what = isPause(probe.status)
    ? `El motor está EN PAUSA por cuota de hosting (HTTP ${probe.http_status ?? 429}).`
    : probe.status === 'timeout'
      ? 'El motor NO responde a tiempo (la sonda se rindió).'
      : `El motor NO responde${probe.http_status ? ` (HTTP ${probe.http_status})` : ''}.`;
  const impact = isPause(probe.status)
    ? 'No se pierde ninguna oferta: su catálogo sigue guardado y se reactiva al reiniciarse la cuota del mes. Mientras tanto las alumnas siguen viendo las ofertas externas aprobadas.'
    : 'Mientras no responda, no se recogen ofertas nuevas ni se clasifica su catálogo; las alumnas siguen viendo las ofertas externas aprobadas.';
  return {
    subject: `[WDC] ${isPause(probe.status) ? 'El motor en pausa por cuota' : 'El motor no responde'}${probe.http_status ? ` (HTTP ${probe.http_status})` : ''}`,
    text: [what, probe.detail, `Detectado: ${when}.`, impact, `Puedes ver el estado y comprobarlo cuando quieras en: ${panel}/admin (pestaña Fuentes).`, 'Recibes este aviso una sola vez por estado: no se repite en cada comprobación.'].join('\n\n'),
  };
}

/** Propietarios de la lista de operadores. Nunca alumnas ni terceros. */
export async function alertRecipients(): Promise<string[]> {
  const admins = await listAdmins().catch(() => null);
  return (admins ?? []).filter(row => row.role === 'owner').map(row => row.email);
}

export async function sendAlertEmail({
  probe,
  kind,
  detectedAt,
  to,
  env = process.env,
  fetchImpl = fetch,
}: {
  probe: EngineProbe;
  kind: NotifyKind;
  detectedAt: string;
  to?: string[];
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<EmailOutcome> {
  const recipients = to ?? (await alertRecipients());
  if (!recipients.length) return { attempted: false, sent: false, to: [], detail: 'No hay propietario en la lista de usuarios: no hay a quién avisar.' };
  const key = await getSecret('resend').catch(() => null);
  // «Por correo si hay clave»: sin clave guardada no se envía nada y se dice por qué.
  if (!key) return { attempted: false, sent: false, to: recipients, detail: 'Sin clave de Resend guardada (Panel → APIs): el aviso no sale por correo.' };
  const from = (env.RESEND_FROM ?? '').trim() || 'onboarding@resend.dev';
  const base = (env.RESEND_API_BASE ?? 'https://api.resend.com').replace(/\/$/, '');
  const { subject, text } = alertEmail(probe, kind, detectedAt, panelUrl(env));
  try {
    const response = await fetchImpl(`${base}/emails`, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, text }),
    });
    const data = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
    // El resultado de la escritura SIEMPRE se consume: un envío fallido no se cuenta como aviso enviado.
    if (!response.ok) {
      return { attempted: true, sent: false, to: recipients, detail: `Resend rechazó el aviso (HTTP ${response.status}${clean(data?.message) ? `: ${clean(data?.message)}` : ''}).` };
    }
    return { attempted: true, sent: true, to: recipients, detail: `Aviso enviado a ${recipients.join(', ')}${data?.id ? ` (id ${data.id})` : ''}.` };
  } catch {
    return { attempted: true, sent: false, to: recipients, detail: 'No se pudo contactar con Resend.' };
  }
}

// ── Instantánea y comprobación ────────────────────────────────────────────────────────────────────────
type Snapshot = { probe: EngineProbe; log: AlertLog; owners: string[]; key_saved: boolean };

async function snapshot(probeTimeoutMs?: number): Promise<Snapshot> {
  const [probe, log, owners, connections] = await Promise.all([
    probeEngine({ timeoutMs: probeTimeoutMs }),
    readAlertLog(),
    alertRecipients(),
    listConnections().catch(() => null),
  ]);
  return { probe, log, owners, key_saved: Boolean(connections?.some(row => row.provider === 'resend')) };
}

type FreshRow = { status: EngineStatus; since: string; checked_at: string; checked_by: string };

function compose(
  snap: Snapshot,
  extra: { recorded: boolean; decision: AlertDecision | null; email: EmailOutcome | null; notify_blocked: string | null; last_notified?: NotifyInfo['last']; latest?: FreshRow },
): AlertReport {
  const { probe, log, owners, key_saved } = snap;
  // El aviso recién enviado en ESTA comprobación manda sobre el historial leído antes de escribir: si no, el
  // panel diría «aún no se ha enviado» justo después de enviarlo. Lo mismo con la fila recién registrada:
  // sin ella, el panel no daría la fecha de detección ni la última comprobación hasta la siguiente lectura.
  const stored = log.rows.find(row => row.notified_at) ?? null;
  const latest = extra.latest ?? log.rows[0] ?? null;
  const last = extra.last_notified ?? (stored ? { kind: stored.notified_kind ?? 'outage', at: stored.notified_at!, detail: stored.notified_detail, status: stored.status } : null);
  return {
    generated_at: new Date().toISOString(),
    engine: {
      ...probe,
      // «Detectado el …»: el primer registro del estado actual, no una hora inventada.
      since: isOutage(probe.status) && latest?.status === probe.status ? latest.since : null,
      last_checked_at: latest?.checked_at ?? null,
      last_checked_by: latest?.checked_by ?? null,
    },
    log: { available: log.available, problem: log.problem },
    notify: {
      key_saved,
      to: owners,
      blocked: key_saved ? (owners.length ? null : 'no hay propietario en la lista de usuarios') : 'sin clave de Resend guardada (Panel → APIs)',
      last,
    },
    ...extra,
  };
}

/** Solo lectura: qué pasa ahora mismo y qué se ha avisado. No escribe ni envía nada. */
export async function readStatus(probeTimeoutMs?: number): Promise<AlertReport> {
  return compose(await snapshot(probeTimeoutMs), { recorded: false, decision: null, email: null, notify_blocked: null });
}

/**
 * Comprueba el motor, registra la comprobación y avisa por correo si toca (una vez por estado).
 * La usan el cron diario y el botón «Comprobar ahora» del panel: el mismo camino, sin copias.
 */
export async function checkEngine({ by = 'cron', notify = true, probeTimeoutMs }: { by?: string; notify?: boolean; probeTimeoutMs?: number } = {}): Promise<AlertReport> {
  const snap = await snapshot(probeTimeoutMs);
  const { probe, log } = snap;
  const decision = decideNotification(log.rows, probe);
  const prev = log.rows[0] ?? null;
  const since = isOutage(probe.status) && prev?.status === probe.status ? prev.since : probe.checked_at;
  const carry = Boolean(prev) && isOutage(probe.status) && prev!.status === probe.status;
  let recorded = false;
  let justRecorded: EngineAlertRow | null = null;
  let email: EmailOutcome | null = null;
  let notify_blocked: string | null = null;

  if (probe.configured && log.available) {
    const inserted = await serviceRest(ALERT_TABLE, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        org_id: ORG,
        status: probe.status,
        http_status: probe.http_status,
        detail: probe.detail,
        since,
        checked_at: probe.checked_at,
        checked_by: by,
        // Mismo estado de avería que la comprobación anterior: hereda su aviso. Cada comprobación inserta una fila
        // nueva y `decideNotification` solo mira la última; sin esto, la tercera comprobación de una pausa ya
        // avisada veía «sin aviso» y lo repetía (y, pasada la ventana de lectura, también la sexta).
        ...(carry ? { notified_at: prev.notified_at, notified_kind: prev.notified_kind, notified_detail: prev.notified_detail } : { notified_at: null, notified_kind: null, notified_detail: null }),
      }),
    }).catch(() => null);
    const row = inserted?.ok ? ((await inserted.json().catch(() => null)) as EngineAlertRow[] | null)?.[0] ?? null : null;
    recorded = Boolean(row);
    justRecorded = row;
    if (notify && decision.kind) {
      email = await sendAlertEmail({ probe, kind: decision.kind, detectedAt: since, to: snap.owners.length ? snap.owners : undefined });
      if (email.sent && row) {
        // Se anota el aviso en la MISMA fila: si la anotación falla, la siguiente comprobación vuelve a
        // intentarlo (sin registro no se puede saber que ya se avisó) en vez de darlo por enviado.
        const patched = await serviceRest(`${ALERT_TABLE}?id=eq.${row.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ notified_at: probe.checked_at, notified_kind: decision.kind, notified_detail: email.detail }),
        }).catch(() => null);
        if (!patched?.ok) notify_blocked = 'El aviso salió por correo, pero no se pudo anotar en el historial: la próxima comprobación podría repetirlo.';
      } else if (!email.sent) {
        notify_blocked = email.detail;
      }
    }
  } else if (notify && decision.kind && !log.available) {
    // Sin historial no se envía: se repetiría en cada comprobación (cada hora, con Vercel Pro).
    notify_blocked = `No se envía el aviso por correo: ${log.problem} Sin registro no se sabe si ya se avisó.`;
  }

  const justSent = email?.sent && decision.kind ? { kind: decision.kind, at: probe.checked_at, detail: email.detail, status: probe.status } : undefined;
  const fresh = justRecorded as FreshRow | null;
  return compose(snap, { recorded, decision, email, notify_blocked, last_notified: justSent, latest: fresh ?? undefined });
}

/** Contexto del aviso para el panel (qué lo dispara y cuándo): una sola redacción, sin inventar horarios. */
export const ALERT_CONTEXT = {
  scheduled: 'Cada día con la recogida (Vercel Cron, 06:00 UTC) y cuando pulses «Comprobar ahora».',
  engine_configured: () => Boolean(engineBase()),
  text: ENGINE_STATUS_TEXT,
};
