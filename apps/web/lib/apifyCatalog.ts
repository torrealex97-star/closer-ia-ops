// Catálogo de «portales» y sus buscadores de repuesto. Quien administra la app elige PORTALES («Indeed», «InfoJobs»…);
// los nombres técnicos de los buscadores (actores de Apify) son un detalle interno: si uno falla, la app prueba el siguiente.
//
// IMPORTANTE (honestidad): los buscadores de esta lista son CANDIDATOS tomados de la tienda de Apify; su existencia y precio
// no se han verificado contra el servicio real desde este entorno. Por eso la app no se fía de ninguno: valida la ficha y el
// esquema al lanzar, vigila el resultado de cada ejecución y pasa al siguiente si falla o devuelve 0 ofertas.
export type Recipe = { actor: string; name: string };
export type Portal = {
  id: string; source: string; name: string; plain: string; caution?: string;
  maxItems: number; testItems: number; query?: string; sites?: string[]; recipes: Recipe[];
};

export const PORTALS: Portal[] = [
  {
    id: 'indeed', source: 'apify-indeed', name: 'Indeed (España)', maxItems: 200, testItems: 10, query: 'closer de ventas',
    plain: 'Uno de los portales con más ofertas comerciales en España.',
    recipes: [
      { actor: 'boncross/indeed-jobs', name: 'Buscador de Indeed A' },
      { actor: 'chuckling_hemp/indeed-jobs-scraper', name: 'Buscador de Indeed B' },
      { actor: 'ayeeyee/indeed-job-scraper', name: 'Buscador de Indeed C' },
      { actor: 'aakash19/jobspy', name: 'Buscador multi-portal (último recurso)' },
    ],
  },
  {
    id: 'infojobs', source: 'apify-infojobs', name: 'InfoJobs', maxItems: 200, testItems: 10, query: 'closer ventas',
    plain: 'El portal de empleo más usado en España. Si ya tienes la clave oficial de InfoJobs en la pestaña APIs, esa vía es gratuita y preferible.',
    recipes: [{ actor: 'haketa/infojobs-scraper', name: 'Buscador de InfoJobs' }],
  },
  {
    id: 'linkedin', source: 'apify-linkedin', name: 'LinkedIn', maxItems: 100, testItems: 10, query: 'closer de ventas',
    plain: 'Ofertas públicas de LinkedIn (sin cuentas personales ni datos de contacto).',
    caution: 'LinkedIn limita el uso automático en sus condiciones. Se busca poco volumen y es una decisión tuya (ADR-011). Viene apagado.',
    recipes: [
      { actor: 'curious_coder/linkedin-jobs-scraper', name: 'Buscador de LinkedIn A' },
      { actor: 'crawlworks/linkedin-job-scraper', name: 'Buscador de LinkedIn B' },
      { actor: 'gopalakrishnan/linkedin-jobs', name: 'Buscador de LinkedIn C' },
      { actor: 'harvestapi/linkedin-job-search', name: 'Buscador de LinkedIn D' },
    ],
  },
  {
    id: 'multi', source: 'apify-jobspy', name: 'Varios portales a la vez', maxItems: 650, testItems: 10,
    plain: 'Un solo buscador que mira Indeed, LinkedIn, Glassdoor y Google Jobs en una pasada.',
    recipes: [{ actor: 'aakash19/jobspy', name: 'Buscador multi-portal' }],
  },
];

export const portalBySource = (source: string) => PORTALS.find(p => p.source === source);
export const portalById = (id: string) => PORTALS.find(p => p.id === id);
