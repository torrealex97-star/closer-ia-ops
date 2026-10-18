// Presupuesto de tiempo de una invocación serverless (el cron de Vercel Hobby tiene 60 s). Un solo reloj para todos los pasos:
// cada paso recibe un `deadline` absoluto (epoch ms) acotado por el fin global y comprueba el reloj ANTES de cada llamada
// externa. Quedarse sin tiempo no es un fallo: el paso se corta, se declara (`truncated`) y el trabajo es idempotente, así que
// la siguiente ejecución continúa. El total interno debe quedar MUY por debajo de `maxDuration` (arranque en frío, middleware).
export const DEFAULT_TOTAL_MS = 40_000;
export const MIN_STEP_MS = 3_000;

export type Budget = {
  end: number; remaining(): number; expired(): boolean;
  /** Fin absoluto del paso: a lo sumo `maxMs` desde ahora y nunca más allá del fin global. */
  deadline(maxMs: number): number;
  /** Anota que un paso se cortó o se saltó. */
  cut(step: string): void; readonly truncated: string[];
  spent(): number;
};

export function createBudget(totalMs: number = DEFAULT_TOTAL_MS, now: () => number = Date.now): Budget {
  const start = now(), end = start + Math.max(0, totalMs), truncated: string[] = [];
  return {
    end, truncated, spent: () => now() - start,
    remaining: () => Math.max(0, end - now()), expired: () => now() >= end,
    deadline: maxMs => Math.min(end, now() + Math.max(0, maxMs)),
    cut: step => { if (!truncated.includes(step)) truncated.push(step); },
  };
}

export const timeLeft = (deadline: number | undefined, now: () => number = Date.now) => deadline === undefined ? Infinity : deadline - now();
/** Timeout de una llamada: el habitual, recortado a lo que queda. */
export const callTimeout = (usual: number, deadline: number | undefined, now: () => number = Date.now) => Math.max(1, Math.floor(Math.min(usual, timeLeft(deadline, now)))); // entero: AbortSignal.timeout lo exige
export const totalFromEnv = (env: NodeJS.ProcessEnv = process.env) => { const n = Number(env.CRON_BUDGET_MS); return Number.isFinite(n) && n >= 5_000 && n <= 50_000 ? n : DEFAULT_TOTAL_MS; };
