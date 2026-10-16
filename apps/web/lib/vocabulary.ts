// Espejo del vocabulario del motor cloud (sites/engine/worker.js: ROLE_KEYWORDS, ES_HINTS, NON_ES_HINTS).
// Solo AYUDA al operador a priorizar borradores en la revisión rápida; la visibilidad para la alumna
// la decide siempre el motor con sus propias reglas. tests/admin-auth/parity.mjs comprueba que no se desvía.
export const ROLE_KEYWORDS: Record<string, string[]> = {
  closer: [
    'closer', 'closer de ventas', 'closer comercial', 'closer high ticket',
    'high ticket closer', 'high-ticket closer', 'closer high-ticket', 'closer de alto ticket', 'closer senior', 'closer b2c',
    'closer b2b', 'closer remoto', 'closser', 'clouser', 'sales closer',
    'especialista en cierre', 'experto en cierre de ventas', 'cerrador de ventas',
    'cerrador comercial', 'cerrador high ticket', 'cerrador de ventas inmobiliarias',
    'cerradora de ventas', 'comercial closer', 'vendedor consultivo',
    'asesor de ventas consultivas', 'venta consultiva', 'ventas consultivas',
    'consultative sales', 'solution selling', 'ventas complejas',
    'full-cycle sales', 'full cycle sales', 'end-to-end sales',
    'closing specialist', 'closing consultant', 'conversion specialist',
    'enrollment advisor', 'enrollment counselor', 'enrollment specialist',
    'enrollment consultant', 'admissions advisor', 'admissions associate',
    'admissions counselor', 'admissions officer', 'admissions consultant',
    'asesor de admisiones', 'asesora de admisiones', 'asesor/a de admisiones',
    'agente de admisiones', 'especialista de admisiones', 'ejecutivo de admisiones',
    'admisiones', 'asesor educativo', 'asesora educativa', 'consultor educativo',
    'orientador academico', 'orientadora academica', 'orientador educativo',
    'asesor de formacion', 'asesor comercial educativo', 'asesor de matricula',
    'ejecutivo de matricula', 'asesor de bootcamp', 'venta de formacion',
    'venta de cursos', 'venta de masters', 'venta de bootcamps',
    'student advisor', 'student enrollment advisor', 'student recruitment advisor',
    'programme advisor', 'program advisor', 'education advisor',
    'academic advisor', 'course advisor', 'bootcamp advisor',
    'patient advisor', 'patient coordinator', 'treatment coordinator',
    'treatment consultant', 'healthcare sales', 'medical sales advisor',
    'asesor de pacientes', 'cierre de matriculas', 'cierre de inscripciones',
  ],
  setter: [
    'setter', 'appointment setter', 'sales setter', 'high-ticket setter',
    'high ticket setter', 'setter de ventas', 'setter comercial', 'setter digital',
    'setter b2b', 'setter b2c', 'setter closer', 'setter/closer', 'setter + closer',
    'appointment booker', 'appointment coordinator', 'agendador de citas',
    'agendadora de citas', 'generador de citas', 'concertador de citas',
    'concertador comercial', 'captador de citas', 'captador de leads',
    'cualificador de leads', 'calificador de leads', 'lead qualifier',
    'lead qualification specialist', 'sales appointment setter',
    'business appointment setter', 'teleconcertador', 'teleoperador comercial',
    'lead generation specialist', 'lead generation',
    'especialista en generacion de leads', 'especialista en prospeccion',
  ],
  cold_caller: [
    'cold caller', 'cold calling', 'llamadas en frio',
    'prospector telefonico', 'prospectora telefonica', 'prospeccion telefonica',
  ],
  account_executive: [
    'account executive', 'ejecutivo de cuentas', 'ejecutiva de cuentas',
    'account manager', 'sales executive', 'sales consultant', 'sales advisor',
    'sales specialist', 'sales representative', 'commercial advisor',
    'commercial executive', 'business development executive',
    'ejecutivo comercial', 'ejecutiva comercial', 'ejecutivo de ventas',
    'ejecutiva de ventas', 'asesor comercial', 'asesora comercial',
    'asesor/a comercial', 'asesor comercial senior', 'representante comercial',
    'representante de ventas', 'representante de ventas senior', 'agente comercial',
    'agente de ventas', 'gestor comercial', 'gestora comercial', 'gestor de ventas',
    'especialista comercial', 'profesional de ventas', 'tecnico comercial',
    'tecnica comercial', 'televendedor', 'televendedora', 'televentas',
    'telemarketing', 'ventas telefonicas', 'ventas por videollamada',
    'consultor comercial', 'consultora comercial', 'consultor de ventas',
    'asesor de ventas', 'asesora de ventas',
    // Variantes con barra del mercado español, plegadas con evidencia del slug
    // asesor-de-ventas (sesión 22): 17/48 anuncios comerciales reales quedaban
    // sin familia porque las variantes no existían (('Asesor/a de Ventas',
    // 'Asesor/a Inmobiliario/a', 'AGENTE INMOBILIARIO/A', 'Vendedor/a').
    // La familia closer NO se pliega: 'asesor de ventas consultivas' sigue
    // ganando por orden de evaluación, y plegar el AE liso diluiría el cierre puro.
    'asesor/a de ventas',
    'asesor inmobiliario', 'asesor/a inmobiliario', 'asesor/a inmobiliario/a',
    'asesores inmobiliarios', 'agente inmobiliario', 'agentes inmobiliarios',
    'agente inmobiliario/a', 'vendedor', 'vendedora', 'vendedor/a',
    'asesor de programas', 'asesor de cursos', 'asesor de masters',
    'comercial digital', 'comercial online', 'inside sales',
    'inside sales representative', 'inside sales specialist',
    'inbound sales representative', 'outbound sales representative',
    'business development manager',
    'sales account executive', 'senior sales executive', 'remote sales consultant',
    'high-ticket sales consultant', 'high ticket sales consultant',
  ],
  sdr: ['sdr', 'bdr', 'sales development', 'sales development representative'],
};
export const ES_HINTS = ['españa', 'spain', 'madrid', 'barcelona', 'valencia', 'sevilla', 'málaga', 'malaga', 'bilbao', 'zaragoza', 'remoto', 'europa'];
export const NON_ES_HINTS = ['florida', 'texas', 'california', 'new york', 'london', 'londres', 'oklahoma', 'mississippi', 'georgia', 'st. petersburg', 'atlanta', 'nashville', 'dallas', 'okc'];

export const ROLE_EVAL_ORDER = ['closer', 'setter', 'cold_caller', 'account_executive', 'sdr'] as const;
export type RoleFamily = (typeof ROLE_EVAL_ORDER)[number];
export const ROLE_LABELS: Record<RoleFamily, string> = { closer: 'Closer', setter: 'Setter', cold_caller: 'Cold Caller', account_executive: 'Ejecutivo comercial', sdr: 'SDR / BDR' };

export const fold = (text: string | null | undefined) => (text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Misma prioridad que el motor para el título: closer primero («Setter y Closer» es closer).
export function roleFromTitle(title: string | null | undefined): RoleFamily | null {
  const t = fold(title);
  return ROLE_EVAL_ORDER.find(role => ROLE_KEYWORDS[role].some(k => t.includes(k))) ?? null;
}

// Señal de España a partir de título + ubicación (null = sin ubicación cargada todavía, no se afirma nada).
export function spainSignal(title: string | null | undefined, location: string | null | undefined): boolean | null {
  if (!location) return null;
  const hay = `${title ?? ''} ${location}`.toLowerCase();
  if (NON_ES_HINTS.some(k => hay.includes(k))) return false;
  return ES_HINTS.some(k => hay.includes(k));
}
