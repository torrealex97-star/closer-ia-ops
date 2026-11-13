// Qué le falta a cada fuente del catálogo que NO es un conector del motor, en pasos concretos.
// El panel decía «Requiere configurar» y ahí se acababa: el operador no sabía si necesitaba una
// clave, un actor de pago o simplemente un enlace. Esto lo responde por tipo de fuente, sin inventar
// requisitos que el proveedor no pida.
export type Setup = { requirement: string; steps: string[]; link?: { href: string; label: string } };

const apify = (name: string, hint: string): Setup => ({
  requirement: `Actor de Apify sobre ${name} (la app ya sabe ejecutarlos y cobrarlos con presupuesto).`,
  steps: [
    'Crea cuenta en Apify y copia tu token de API en el perfil (Settings → Integrations).',
    `Busca un actor de ${name} en la tienda de Apify y copia su Actor ID. ${hint}`,
    'En Fuentes → Añadir fuente: pega token, Actor ID y las URLs de búsqueda (una por línea).',
    'Rellena el mapeo de campos (title, company, location, url, description) con una muestra real.',
    'Guarda y pulsa «Comprobar»: verifica el dataset sin ejecutar nada; «Ejecutar» gasta crédito y pide confirmación.',
  ],
  link: { href: 'https://apify.com/store', label: 'Buscar actor en Apify' },
});

const RECIPES: Record<string, Setup> = {
  infojobs: {
    requirement: 'InfoJobs no publica feed abierto: su API es solo para agregadores con acuerdo firmado (responde 405 al Worker).',
    steps: [
      'Sin acuerdo de agregación no hay vía oficial: no hay clave que pedir en el panel.',
      'Mientras tanto, la vía real es un actor de Apify de InfoJobs con el filtro de teletrabajo.',
      'Añade la fuente con token y Actor ID, y limita las búsquedas a las provincias que te interesan.',
      'Recuerda el coste: Apify cobra por resultado y cada ejecución se autoriza aparte.',
    ],
    link: { href: 'https://apify.com/store', label: 'Actores de InfoJobs en Apify' },
  },
  jooble: {
    requirement: 'Jooble da clave gratuita por correo, pero exige registrarse y su RSS está detrás de Cloudflare para el Worker.',
    steps: [
      'Pide la clave en jooble.org/api/about (es gratis y llega por email).',
      'Guárdala como secreto del Worker (JOOBLE_KEY) y no la pegues en el chat ni en el repositorio.',
      'La llamada va al endpoint JSON de Jooble con país ES y los términos de closer/setter.',
      'Si el Worker sigue recibiendo 403, Jooble está bloqueando la IP de Cloudflare: no se arregla con la clave.',
    ],
    link: { href: 'https://es.jooble.org/api/about', label: 'Pedir clave de Jooble' },
  },
  company: {
    requirement: 'Los ATS públicos (Greenhouse, Ashby, Teamtailor, Recruitee, Lever) son gratis y no piden clave: se añade la empresa al motor.',
    steps: [
      'Identifica el ATS de la empresa mirando su página de empleo (suele ser <empresa>.greenhouse.io o jobs.ashbyhq.com/<empresa>).',
      'Comprueba el slug con la API pública: boards-api.greenhouse.io/v1/boards/<slug>/jobs devuelve 200 y ofertas.',
      'Añádelo al motor como fuente propia (una fila por empresa) y despliega: cuesta 1 petición por pasada.',
      'Si el board responde 401/404, el slug no es público: no se adivina, se descarta.',
    ],
  },
  custom: {
    requirement: 'Cualquier feed RSS o JSON público se conecta sin clave.',
    steps: [
      'Comprueba que la URL responde 200 y devuelve <item> (RSS) o un JSON con título y enlace.',
      'Añádela al motor como fuente de tipo rss con su URL.',
      'Si el portal bloquea al Worker (403/405), no hay conector posible sin proxy o actor de pago.',
    ],
  },
};

export function setupFor(entry: { code: string; name: string; acquisition_method?: string | null }): Setup {
  const direct = RECIPES[entry.code];
  if (direct) return direct;
  const method = (entry.acquisition_method ?? '').toLowerCase();
  if (/rss|feed/.test(method)) return RECIPES.custom;
  return apify(entry.name, 'Lee el esquema de entrada del actor antes de ejecutarlo.');
}
