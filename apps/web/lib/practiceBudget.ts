// Topes de la sala de práctica, en memoria de la instancia (serverless ⇒ best-effort): lo que de verdad contiene el
// gasto es el límite por petición (turnos y caracteres) y el `max_tokens` de cada llamada. Dos defectos que esta pieza
// evita, y que el servidor tenía: (1) la IP salía de la PRIMERA entrada de `x-forwarded-for`, que la escribe quien
// llama ⇒ bastaba cambiarla en cada petición para tener cuota nueva; (2) el mapa crecía sin tope con claves inventadas.
export type HeaderReader = { get(name: string): string | null };

export function clientIp(headers: HeaderReader): string {
  // `x-real-ip` lo pone la plataforma y no se puede falsear desde el navegador.
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  // Si solo hay cadena de proxies, la ÚLTIMA entrada es la que añadió el proxy inmediato; la primera es del cliente.
  const chain = (headers.get('x-forwarded-for') ?? '').split(',').map(part => part.trim()).filter(Boolean);
  return chain[chain.length - 1] || 'local';
}

export const MAX_KEYS = 5000;
const GLOBAL_KEY = 'global';

export function createTurnBudget(options: { now?: () => Date } = {}) {
  const usage = new Map<string, { day: string; count: number }>();
  const today = () => (options.now ?? (() => new Date()))().toISOString().slice(0, 10);

  // Depuración con tope duro: primero fuera lo de otros días; si aun así sobra, se descarta la clave más antigua
  // (el contador global no se toca nunca: es el tope de gasto del día y no puede reiniciarse).
  const prune = (day: string) => {
    if (usage.size <= MAX_KEYS) return;
    for (const [key, value] of usage) if (value.day !== day) usage.delete(key);
    while (usage.size > MAX_KEYS) {
      const oldest = usage.keys().next().value;
      if (oldest === undefined) break;
      const value = usage.get(oldest);
      if (oldest === GLOBAL_KEY && value) { usage.delete(oldest); usage.set(oldest, value); continue; } // se reinserta: pasa a ser el más reciente
      usage.delete(oldest);
    }
  };

  return {
    /** Consume un turno de `key`. Devuelve los que quedan, o `null` si ya está agotado. */
    spend(key: string, limit: number): number | null {
      const day = today();
      const entry = usage.get(key);
      const count = entry && entry.day === day ? entry.count : 0;
      if (count >= limit) return null;
      usage.set(key, { day, count: count + 1 });
      prune(day);
      return limit - count - 1;
    },
    get size() { return usage.size; },
  };
}
