import { callTimeout, timeLeft } from './cronBudget';

// Clasificación automática del catálogo del motor (`POST /v1/admin/opportunities/activate`):
// deriva el perfil y el payload de la oferta con reglas deterministas, verifica el enlace y
// publica lo verificado abierto. Lo que no es un puesto comercial, no está en español o está
// fuera de la ventana se RETIRA con su razón: no se queda pidiendo revisión humana.
// Cada pasada escribe como mucho unas pocas ofertas (presupuesto del Worker), así que se
// repite hasta que el motor dice que ya no corta o se acaba el reloj de la invocación.
export type ActivateCounts = { published: number; needs_review: number; skipped: number; withdrawn: number; deferred: number };

export type ActivateResult = {
  passes: number;
  counts: ActivateCounts;
  /** El motor declara que quedó trabajo para la siguiente pasada. */
  truncated: boolean;
  /** Motivo por el que no se pudo hablar con el motor, si lo hubo. */
  error?: string;
};

const EMPTY: ActivateCounts = { published: 0, needs_review: 0, skipped: 0, withdrawn: 0, deferred: 0 };

type Page = { counts?: Partial<ActivateCounts>; scan?: { truncated?: boolean }; detail?: string };

export async function activateEngine(init: {
  passes?: number; market?: 'ES' | 'any'; deadline?: number; env?: NodeJS.ProcessEnv;
} = {}): Promise<ActivateResult | null> {
  const env = init.env ?? process.env;
  const base = (env.CAREER_ENGINE_URL ?? '').replace(/\/$/, '');
  const token = env.CAREER_ADMIN_TOKEN;
  if (!base || !token) return null; // modo local o token ausente: el panel ya lo dice
  const maxPasses = Math.max(1, Math.min(init.passes ?? 12, 40));
  const counts: ActivateCounts = { ...EMPTY };
  let passes = 0, truncated = false, error: string | undefined;
  while (passes < maxPasses) {
    // Sin tiempo para una pasada (verificación de enlaces incluida) no se empieza otra.
    if (timeLeft(init.deadline) < 8_000) { truncated = true; break; }
    let page: Page | null = null;
    try {
      const response = await fetch(`${base}/v1/admin/opportunities/activate`, {
        method: 'POST', cache: 'no-store',
        headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false, verify: true, market: init.market ?? 'any' }),
        signal: AbortSignal.timeout(callTimeout(40_000, init.deadline)),
      });
      page = response.ok ? await response.json().catch(() => null) : null;
      if (!response.ok) error = `el motor respondió ${response.status}`;
    } catch (err) {
      const timedOut = (err as Error)?.name === 'TimeoutError';
      error = timedOut ? 'el motor no respondió a tiempo' : 'error de red con el motor';
      if (timedOut) truncated = true; // quedó trabajo sin hacer: el cron lo anota como corte, no lo esconde
      break;
    }
    if (!page) break;
    passes += 1;
    for (const key of Object.keys(EMPTY) as Array<keyof ActivateCounts>) counts[key] += Number(page.counts?.[key] ?? 0);
    truncated = Boolean(page.scan?.truncated);
    // Nada publicado, retirado ni movido a revisión: el barrido no encontró nada accionable y repetir no cambia nada.
    // (Lo que pasa a `needs_review` también sale del pool de borradores: es progreso.)
    if (!truncated) break;
    if ((page.counts?.published ?? 0) + (page.counts?.withdrawn ?? 0) + (page.counts?.needs_review ?? 0) === 0) break;
  }
  return { passes, counts, truncated, ...(error ? { error } : {}) };
}
