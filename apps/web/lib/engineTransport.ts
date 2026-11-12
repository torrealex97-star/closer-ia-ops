// Cómo se habla con el motor desde la web.
//
// Medido en la sesión 148: desde el Worker desplegado, un `fetch` al `workers.dev` del motor NO llega a
// destino (el `tail` del motor no registra nada) y la vista de alumna cae a `engine_down`; el mismo código
// en workerd local sí responde 200. Cloudflare corta esa llamada de Worker a Worker por la red pública.
//
// La forma correcta es un *service binding* (`env.ENGINE`): la llamada va por dentro de la plataforma y no
// depende de DNS ni de workers.dev. Fuera de Workers (Vercel, `next dev`) no hay binding: se usa `fetch`
// normal, así que el mismo código vale en los dos despliegues y el corte de dominio puede esperar.

type EngineBinding = { fetch: (input: string, init?: RequestInit) => Promise<Response> };

async function engineBinding(): Promise<EngineBinding | null> {
  try {
    const mod = await import('@opennextjs/cloudflare').catch(() => null);
    if (!mod) return null;
    const env = (mod.getCloudflareContext().env ?? {}) as { ENGINE?: EngineBinding };
    return typeof env.ENGINE?.fetch === 'function' ? env.ENGINE : null;
  } catch {
    // En Node no hay contexto de Cloudflare: no es un error, es el otro despliegue.
    return null;
  }
}

/** Igual que `fetch`, pero por el binding del motor cuando corremos en Workers. */
export async function engineFetch(url: string, init?: RequestInit): Promise<Response> {
  const binding = await engineBinding();
  if (binding) {
    // El binding ignora el host y resuelve por el nombre del servicio; la ruta y la query se conservan.
    const { pathname, search } = new URL(url);
    try {
      return await binding.fetch(`https://engine${pathname}${search}`, init);
    } catch {
      // Si el binding no está disponible en este entorno (p. ej. preview local sin el servicio),
      // se intenta por red antes de dar el motor por caído.
    }
  }
  return fetch(url, init);
}
