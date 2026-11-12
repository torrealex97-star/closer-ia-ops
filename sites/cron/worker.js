// Reloj diario de la plataforma, en la cuenta propia (ADR-018).
//
// Vive aparte de la web porque el Worker que genera OpenNext solo exporta `fetch`: un cron de
// Cloudflare invoca `scheduled`, y añadirlo dentro obligaría a parchear el bundle generado en cada
// build. Este Worker no tiene lógica de negocio: llama a `/api/cron/collect` de la web con el
// secreto compartido y deja el resultado en Observability, que es donde se mira si un día la
// recogida se cortó o falló.
//
// El secreto NO va en `[vars]`: se sube con `wrangler secret put CRON_SECRET` y es el mismo que
// tiene `closer-web`, porque la ruta lo compara con `timingSafeEqual`.
export default {
  async scheduled(_controller, env, _ctx) {
    const started = Date.now();
    try {
      const response = await fetch(`${env.APP_URL}/api/cron/collect`, {
        headers: { authorization: `Bearer ${env.CRON_SECRET}`, 'user-agent': 'closer-cron' },
        // La ruta se da 40 s de presupuesto; 120 s deja margen para el arranque en frío sin que la
        // invocación se quede colgada si la web deja de responder.
        signal: AbortSignal.timeout(120_000),
      });
      const text = await response.text();
      // `truncated` es la LISTA de pasos que se cortaron, no un booleano: buscarlo como texto
      // (`"truncated":true`) daba «sin cortes» casi siempre, que es justo lo contrario de lo que
      // este registro tiene que detectar.
      let cut = [];
      let motorTruncated = null;
      try {
        const body = JSON.parse(text);
        cut = Array.isArray(body?.truncated) ? body.truncated : [];
        motorTruncated = body?.motor ? Boolean(body.motor.truncated) : null;
      } catch { /* respuesta no JSON (p. ej. un 5xx en texto plano): queda el cuerpo y el estado */ }
      console.log(JSON.stringify({
        event: 'cron_collect',
        status: response.status,
        ms: Date.now() - started,
        cut,
        motor_truncated: motorTruncated,
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
