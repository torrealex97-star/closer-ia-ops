import { fold } from './vocabulary';

// Etiquetas orientativas de una oferta: nicho y modelo de pago, leídas SOLO del texto del anuncio con palabras clave.
// Sin señal clara devuelven `null` (no «otros»): un hueco no es un dato. No filtran ni ocultan nada; ayudan a revisar.
export type PayModel = 'solo_comision' | 'fijo_mas_comision' | 'fijo' | 'no_indicado';
export type Niche = 'formacion' | 'saas_b2b' | 'salud_estetica' | 'inmobiliaria_reformas' | 'fitness_bienestar';
export type OfferTags = { niche: Niche | null; pay: PayModel };

export const PAY_LABELS: Record<PayModel, string> = { solo_comision: 'Solo comisión', fijo_mas_comision: 'Fijo + comisión', fijo: 'Fijo', no_indicado: 'Pago no indicado' };
export const NICHE_LABELS: Record<Niche, string> = { formacion: 'Formación / infoproducto', saas_b2b: 'Software B2B', salud_estetica: 'Salud y estética', inmobiliaria_reformas: 'Inmobiliaria y reformas', fitness_bienestar: 'Fitness y bienestar' };

const NICHES: [Niche, RegExp][] = [
  ['formacion', /\b(?:infoproductos?|high.?ticket|alto ticket|formacion|cursos?|academia|mentoria|coaching|bootcamp|masterclass)\b/g],
  ['saas_b2b', /\b(?:saas|software|b2b|crm|erp|licencias? de software|plataforma digital)\b/g],
  ['salud_estetica', /\b(?:clinica|dental|ortodoncia|estetica|fisioterapia|nutricion|odontolog\w+|salud)\b/g],
  ['inmobiliaria_reformas', /\b(?:inmobiliari\w+|reformas?|construccion|viviendas?|hipotecas?)\b/g],
  ['fitness_bienestar', /\b(?:fitness|gimnasio|entrenador\w*|bienestar|yoga|pilates)\b/g],
];

export function offerTags(offer: { title?: string | null; description?: string | null; salary?: string | null }): OfferTags {
  const text = fold(`${offer.title ?? ''}\n${offer.description ?? ''}`);
  // El título pesa doble: es lo que más dice del puesto.
  const title = fold(offer.title ?? '');
  const scored = NICHES.map(([niche, re]) => [niche, (text.match(re)?.length ?? 0) + (title.match(re)?.length ?? 0)] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const niche = scored.length && (scored.length === 1 || scored[0][1] > scored[1][1]) ? scored[0][0] : null; // un empate no elige

  const commissionOnly = /\b(?:100\s*%\s*(?:a\s+)?comision|solo comision(?:es)?|unicamente comision(?:es)?|comision pura|sin (?:sueldo|salario) fijo|sin fijo)\b/.test(text);
  const commission = /\b(?:comision(?:es)?|variable|bonus|incentivos?)\b/.test(text);
  const fixed = Boolean(offer.salary) || /\b(?:sueldo fijo|salario fijo|fijo mensual|fijo \+|\d[\d.,]*\s*(?:€|eur|euros?)\s*(?:brutos?|\/\s*(?:ano|mes)|al mes|mensuales?))\b/.test(text);
  const pay: PayModel = commissionOnly ? 'solo_comision' : fixed && commission ? 'fijo_mas_comision' : fixed ? 'fijo' : 'no_indicado';
  return { niche, pay };
}
