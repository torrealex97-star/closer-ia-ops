// Fuentes que el SOP diario de WDC nombra y que la app aún no recoge todas. Sirven para decidir qué
// incorporar sin adivinar: cada una dice dónde buscar, qué se espera y cómo entra hoy (conector ya
// activo, pegar su búsqueda en «Añadir fuente», o canal manual porque exige sesión).
// Solo se listan URL que el documento o el catálogo dan literalmente. Nada de direcciones supuestas:
// el SOP marca muchas como «asumido» y esas no se incluyen hasta comprobarlas.
export type IdeaFamily = 'España' | 'LatAm' | 'Freelance' | 'Remoto' | 'Agregadores' | 'Comunidades';
export type IdeaCost = 'gratis' | 'api' | 'pago' | 'manual';
export type Idea = {
  name: string; url: string; family: IdeaFamily; cost: IdeaCost;
  why: string;                       // por qué es probable que tenga closers
  how: 'conector' | 'pegar-enlace' | 'manual';
  terms?: string;                    // búsqueda recomendada por el SOP
};

export const SOURCE_IDEAS: Idea[] = [
  // ── España ────────────────────────────────────────────────────────────────
  { name: 'InfoJobs', url: 'https://www.infojobs.net', family: 'España', cost: 'api', how: 'conector', terms: 'closer de ventas',
    why: 'El portal con más ofertas comerciales de España y el que el SOP pone primero. Ya entra con su clave oficial cada mañana.' },
  { name: 'Indeed España', url: 'https://es.indeed.com', family: 'España', cost: 'gratis', how: 'pegar-enlace', terms: 'closer de ventas',
    why: 'Agrega anuncios de pymes y agencias que no publican en InfoJobs. Llega por el recolector JobSpy sin coste.' },
  { name: 'LinkedIn Empleos', url: 'https://www.linkedin.com/jobs', family: 'España', cost: 'gratis', how: 'pegar-enlace', terms: 'high ticket closer',
    why: 'Donde publican las agencias de high ticket y los infoproductores. Volumen bajo pero muy ajustado al perfil.' },
  // ── LatAm ─────────────────────────────────────────────────────────────────
  { name: 'Computrabajo', url: 'https://www.computrabajo.com', family: 'LatAm', cost: 'gratis', how: 'pegar-enlace', terms: 'closer de ventas',
    why: 'El portal de referencia en Colombia, Perú y México; citado en el SOP como fuente diaria de LatAm.' },
  { name: 'Bumeran', url: 'https://www.bumeran.com', family: 'LatAm', cost: 'gratis', how: 'pegar-enlace', terms: 'closer',
    why: 'Argentina y Chile, con muchos puestos comerciales en dólares para equipos remotos.' },
  { name: 'OCCMundial', url: 'https://www.occ.com.mx', family: 'LatAm', cost: 'gratis', how: 'pegar-enlace', terms: 'closer de ventas',
    why: 'México: el SOP lo separa del resto porque concentra ofertas de venta telefónica y cierre.' },
  // ── Freelance ─────────────────────────────────────────────────────────────
  { name: 'Workana', url: 'https://www.workana.com/es', family: 'Freelance', cost: 'gratis', how: 'pegar-enlace', terms: 'closing ventas',
    why: 'Proyectos de «closer a comisión» publicados por agencias que no abren una vacante formal.' },
  { name: 'Freelancer', url: 'https://www.freelancer.es', family: 'Freelance', cost: 'gratis', how: 'pegar-enlace', terms: 'high ticket closing',
    why: 'Encargos cortos de cierre y appointment setting; el SOP pide 5 propuestas diarias entre marketplaces.' },
  { name: 'Fiverr', url: 'https://es.fiverr.com', family: 'Freelance', cost: 'gratis', how: 'pegar-enlace', terms: 'sales closer',
    why: 'Menos vacantes y más encargos puntuales; útil para las primeras llamadas reales.' },
  { name: 'Malt', url: 'https://www.malt.es', family: 'Freelance', cost: 'gratis', how: 'pegar-enlace', terms: 'closer',
    why: 'Freelance europeo con tarifas en euros: encaja con el mercado España/Europa.' },
  { name: 'Upwork', url: 'https://www.upwork.com', family: 'Freelance', cost: 'gratis', how: 'pegar-enlace', terms: 'high ticket closer',
    why: 'El marketplace que el SOP pone primero para contratos en dólares (LatAm y EE. UU.).' },
  { name: 'SoyFreelancer', url: 'https://www.soyfreelancer.com', family: 'Freelance', cost: 'gratis', how: 'pegar-enlace', terms: 'closer',
    why: 'Comunidad hispana pequeña; el SOP la trata como fuente de rotación semanal, no diaria.' },
  // ── Remoto ────────────────────────────────────────────────────────────────
  { name: 'WeRemoto', url: 'https://weremoto.com', family: 'Remoto', cost: 'gratis', how: 'pegar-enlace', terms: 'sales closer',
    why: 'Remoto en español, con startups que buscan primer comercial.' },
  { name: 'Remote OK', url: 'https://remoteok.com', family: 'Remoto', cost: 'gratis', how: 'conector', terms: 'sales',
    why: 'Feed público que la app ya recoge; aporta el mercado en dólares.' },
  { name: 'Remotive', url: 'https://remotive.com', family: 'Remoto', cost: 'gratis', how: 'conector', terms: 'sales',
    why: 'Conector operativo ya: categoría de ventas en inglés y español.' },
  { name: 'JobFluent', url: 'https://www.jobfluent.com', family: 'Remoto', cost: 'gratis', how: 'pegar-enlace', terms: 'sales',
    why: 'Empresas europeas con equipos en español; interesa por el salario en euros.' },
  { name: 'Europe Language Jobs', url: 'https://www.europelanguagejobs.com', family: 'Remoto', cost: 'gratis', how: 'pegar-enlace', terms: 'spanish sales',
    why: 'Puestos que piden español en toda Europa; el SOP lo incluye en el bloque de trabajo remoto.' },
  { name: 'Wellfound', url: 'https://wellfound.com', family: 'Remoto', cost: 'gratis', how: 'pegar-enlace', terms: 'account executive spanish',
    why: 'Startups B2B que contratan su primer AE con español.' },
  // ── Agregadores ───────────────────────────────────────────────────────────
  { name: 'BeBee', url: 'https://bebee.com', family: 'Agregadores', cost: 'gratis', how: 'pegar-enlace', terms: 'sales closer',
    why: 'Agregador que el SOP cita para «Sales Closer» en España; republica anuncios de otros portales.' },
  // ── Comunidades (manual: exigen sesión propia) ─────────────────────────────
  { name: 'Closer de ventas principiantes', url: 'https://www.facebook.com/groups/1395506754506668', family: 'Comunidades', cost: 'manual', how: 'manual', terms: 'closer',
    why: 'Grupo de Facebook en español con vacantes de entrada; el SOP lo usa a diario.' },
  { name: 'Closer de Ventas de Alto Valor', url: 'https://www.facebook.com/groups/719085275327684/', family: 'Comunidades', cost: 'manual', how: 'manual', terms: 'closer',
    why: 'El grupo grande de high ticket en español: es donde más se pide closer a comisión.' },
  { name: 'Trabajo Closer de Ventas Remoto', url: 'https://www.facebook.com/groups/empleocloserdeventas/', family: 'Comunidades', cost: 'manual', how: 'manual', terms: 'closer',
    why: 'Vacantes diarias de closer remoto, casi todas en dólares.' },
  { name: 'Closer de Ventas Mexico', url: 'https://www.facebook.com/groups/562319769693968/', family: 'Comunidades', cost: 'manual', how: 'manual', terms: 'closer',
    why: 'Mercado mexicano; encaja con el filtro LatAm.' },
  { name: 'Closer de ventas Colombia', url: 'https://www.facebook.com/groups/769202395425443/', family: 'Comunidades', cost: 'manual', how: 'manual', terms: 'closer',
    why: 'Colombia es el segundo mercado del SOP después de España.' },
  { name: 'SETTERS Y CLOSERS DE VENTA', url: 'https://www.facebook.com/groups/720430409904628/', family: 'Comunidades', cost: 'manual', how: 'manual', terms: 'setter closer',
    why: 'Puestos mixtos setter/closer, que el vocabulario ya reconoce como closer.' },
  { name: 'Shovelify', url: 'https://t.me/shovelifycom', family: 'Comunidades', cost: 'manual', how: 'manual', terms: 'closer',
    why: 'El canal que el SOP señala como la vía más seria en español para conectar closers con ofertas.' },
  { name: 'Comizzion', url: 'https://t.me/comizzion', family: 'Comunidades', cost: 'manual', how: 'manual', terms: 'closer',
    why: 'Lanzamientos high ticket con comisiones altas; publica necesidades de equipo de cierre.' },
  { name: 'Cerrando con Tomas', url: 'https://t.me/CerrandoConTomas', family: 'Comunidades', cost: 'manual', how: 'manual', terms: 'closer',
    why: 'Comunidad de closers profesionales en España; ofertas por referencia.' },
  { name: 'Vacantes Remotas', url: 'https://t.me/vacantesremotas', family: 'Comunidades', cost: 'manual', how: 'manual', terms: 'closer setter',
    why: 'El canal con más volumen de España y LatAm según el SOP; hay que filtrar a mano.' },
  { name: 'Trabajos Remotos LATAM', url: 'https://t.me/trabajos_remotos_latam', family: 'Comunidades', cost: 'manual', how: 'manual', terms: 'ventas',
    why: 'Ofertas en dólares para LatAm; complementa los dorks de Google Jobs en mx/co/ar.' },
  { name: 'Ofertas de Teletrabajo', url: 'https://t.me/ofertasteletrabajo', family: 'Comunidades', cost: 'manual', how: 'manual', terms: 'comercial',
    why: 'Enfocado en España; útil para comerciales y business development.' },
];

export const IDEA_HOW_LABEL: Record<Idea['how'], string> = {
  conector: 'Conector activo',
  'pegar-enlace': 'Añadir pegando su búsqueda',
  manual: 'Manual (exige sesión)',
};

export const IDEA_COST_LABEL: Record<IdeaCost, string> = { gratis: 'Gratis', api: 'API con clave', pago: 'De pago', manual: 'Manual' };
