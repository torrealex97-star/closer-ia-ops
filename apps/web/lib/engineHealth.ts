// Salud del motor cloud: UNA sola forma de sondearlo y de nombrar su estado.
//
// Medido en producción (sesión 123): cuando el sitio está publicado pero la cuota del mes se agotó, la
// plataforma responde `429` con TEXTO PLANO («This site has reached its hosting allowance»). Eso es una
// PAUSA que se arregla sola al reiniciarse la cuota, no una caída: el panel, el aviso por correo y el cron
// tienen que decir lo mismo y no confundirlas. Antes esta clasificación vivía solo dentro de la ruta del
// panel; al añadir el aviso automático habría quedado una copia que se desvía de la otra.

export type EngineStatus = 'ok' | 'allowance' | 'timeout' | 'down' | 'unconfigured';
/** Estados que se guardan y se avisan: `unconfigured` no es una avería del motor, es configuración que falta. */
export type NotifyStatus = Exclude<EngineStatus, 'unconfigured'>;
export type NotifyKind = 'outage' | 'recovery';

export const isOutage = (status: EngineStatus): boolean => status === 'allowance' || status === 'timeout' || status === 'down';
export const isPause = (status: EngineStatus): boolean => status === 'allowance';

// Texto único de cada estado, compartido por la tarjeta de conexiones del panel, el banner de aviso y el
// correo. Si cambia aquí, cambia en los tres sitios: no hay una segunda redacción que se desvíe.
export const ENGINE_STATUS_TEXT: Record<EngineStatus, string> = {
  ok: 'Responde.',
  allowance:
    'En pausa por cuota de hosting (la plataforma responde 429). Sus ofertas no se pierden: se reactiva al reiniciarse la cuota del mes.',
  timeout: 'No responde a tiempo (se agotó la espera de la sonda).',
  down: 'No responde.',
  unconfigured: 'Falta CAREER_ENGINE_URL en el servidor.',
};

export const engineBase = (): string => (process.env.CAREER_ENGINE_URL ?? '').replace(/\/$/, '');

export type EngineFetch<T = Record<string, unknown>> = { ok: boolean; data: T | null; http_status: number | null; reason: EngineStatus };

/** GET al motor que NUNCA lanza: devuelve el resultado y su causa clasificada. */
export async function engineGet<T = Record<string, unknown>>(
  url: string,
  { timeoutMs = 20_000, fetchImpl = fetch }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<EngineFetch<T>> {
  try {
    const response = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok) return { ok: true, data: await response.json().catch(() => null), http_status: response.status, reason: 'ok' };
    const text = await response.text().catch(() => '');
    // Una pausa de cuota se reconoce por el 429 + «allowance»; si la plataforma cambiara ese texto, se
    // leería como «no responde»: honesto, pero menos específico.
    return { ok: false, data: null, http_status: response.status, reason: response.status === 429 || /allowance/i.test(text) ? 'allowance' : 'down' };
  } catch (error) {
    return { ok: false, data: null, http_status: null, reason: (error as Error)?.name === 'TimeoutError' ? 'timeout' : 'down' };
  }
}

export type EngineProbe = {
  configured: boolean;
  status: EngineStatus;
  http_status: number | null;
  detail: string;
  catalog_active: number | null;
  raw_items: number | null;
  ms: number;
  checked_at: string;
};

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Sonda corta del motor (por defecto 8 s: la usa el panel en cada carga y el cron antes de recoger). */
export async function probeEngine(
  { timeoutMs = 8_000, fetchImpl = fetch, now = Date.now }: { timeoutMs?: number; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<EngineProbe> {
  const base = engineBase();
  const started = now();
  const checked_at = new Date(now()).toISOString();
  if (!base) {
    return { configured: false, status: 'unconfigured', http_status: null, detail: ENGINE_STATUS_TEXT.unconfigured, catalog_active: null, raw_items: null, ms: 0, checked_at };
  }
  const result = await engineGet(`${base}/api/status`, { timeoutMs, fetchImpl });
  const status: EngineStatus = result.ok ? 'ok' : result.reason;
  return {
    configured: true,
    status,
    http_status: result.http_status,
    detail: ENGINE_STATUS_TEXT[status],
    catalog_active: result.ok ? count(result.data?.catalog_active) : null,
    raw_items: result.ok ? count(result.data?.raw_items) : null,
    ms: now() - started,
    checked_at,
  };
}
