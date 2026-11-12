import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Port de la web a Cloudflare Workers (ADR-018, incremento aparte del motor).
// Sin caché incremental: todas las rutas del panel y de la alumna son `force-dynamic` y los datos
// viven en Supabase, así que no hay ISR que persistir. Si algún día se añade, va a R2 aquí.
export default defineCloudflareConfig({});
