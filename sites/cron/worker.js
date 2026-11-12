// Reloj diario de la plataforma, en la cuenta propia (ADR-018).
//
// Vive aparte de la web porque el Worker que genera OpenNext solo exporta `fetch`: un cron de
// Cloudflare invoca `scheduled`, y añadirlo dentro obligaría a parchear el bundle generado en cada
// build. Este Worker no tiene lógica de negocio: llama a `/api/cron/collect` de la web con el
// secreto compartido y deja el resultado en Observability, que es donde se mira si un día la
// recogida se cortó (`truncated: true`) o falló.
//
// El secreto NO va en `[vars]`: se sube con `wrangler secret put CRON_SECRET` y es el mismo que
// tiene `closer-web`, porque la ruta lo compara con `timingSafeEqual`.
export default {
  async scheduled(_controller, env, _ctx) {
    const started = Date.now();
    try {
      const response = await fetch(`${env.APP_URL}/api/cron/collect`, {
        headers: { authorization: `Bearer ${env.CRON_SECRET}`, 'user-agent': 'closer-cron' },
      });
      const text = await response.text();
      // Se recorta el cuerpo: la respuesta trae el detalle de cada paso y aquí solo interesa poder
      // ver el estado, si se cortó y cuánto tardó.
      console.log(JSON.stringify({
        event: 'cron_collect',
        status: response.status,
        ms: Date.now() - started,
        truncated: text.includes('"truncated":true'),
        body: text.slice(0, 800),
      }));
    } catch (error) {
      console.log(JSON.stringify({
        event: 'cron_collect_failed',
        ms: Date.now() - started,
        error: String(error?.message ?? error),
      }));
    }
  },

  // Sin superficie pública: si alguien abre la URL, no hay nada que ver.
  async fetch() {
    return new Response('closer-cron: solo cron', { status: 404 });
  },
};
