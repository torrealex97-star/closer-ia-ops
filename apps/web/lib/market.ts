import { spainSignal } from './esPlaces';
import { fold } from './vocabulary';

// Mercado de una oferta externa. Dos señales, en este orden:
// 1) la ubicación que publica el anuncio manda;
// 2) si la ubicación no dice nada, el importe: euros ⇒ España/Europa, dólares ⇒ LatAm/EE. UU.
// Nunca se inventa: sin ubicación útil y sin importe, el mercado queda desconocido (`null`) y la
// oferta sigue visible en «todos los mercados», pero no se cuela en un filtro de país.
// Las tres etiquetas son las que permite el CHECK de `external_offers.market` (ES, LATAM, US_LATINO).
// `US_LATINO` significa «mercado en dólares»: vale tanto para EE. UU. como para LatAm, que es como
// lo piden las alumnas (un closer de LatAm aplica a ofertas pagadas en USD publicadas desde Miami).
export type Market = 'ES' | 'LATAM' | 'US_LATINO';
export type Currency = 'EUR' | 'USD';
export type MarketBasis = 'ubicacion_espana' | 'ubicacion_latam' | 'ubicacion_estados_unidos' | 'moneda_eur' | 'moneda_usd' | 'sin_senal';
export type MarketVerdict = { market: Market | null; basis: MarketBasis; currency: Currency | null };

// Ciudades y países que no se confunden con España (Córdoba, Santiago, San José o La Paz existen en
// ambos lados, así que solo cuentan con el país al lado o con una forma inequívoca).
const LATAM = [
  'latam', 'latinoamerica', 'latino americano', 'america latina', 'suramerica', 'sudamerica',
  'mexico', 'cdmx', 'ciudad de mexico', 'guadalajara', 'monterrey', 'queretaro', 'puebla', 'tijuana',
  'colombia', 'bogota', 'medellin', 'cali', 'barranquilla', 'cartagena de indias',
  'argentina', 'buenos aires', 'rosario', 'mendoza', 'cordoba argentina',
  'chile', 'santiago de chile', 'valparaiso', 'concepcion chile',
  'peru', 'lima peru', 'arequipa', 'trujillo peru',
  'ecuador', 'quito', 'guayaquil', 'cuenca ecuador',
  'uruguay', 'montevideo', 'venezuela', 'caracas', 'maracaibo',
  'guatemala', 'costa rica', 'san jose costa rica', 'panama city', 'ciudad de panama',
  'bolivia', 'la paz bolivia', 'santa cruz de la sierra', 'paraguay', 'asuncion',
  'republica dominicana', 'santo domingo', 'el salvador', 'san salvador', 'honduras', 'tegucigalpa',
  'nicaragua', 'managua', 'puerto rico', 'san juan de puerto rico',
  'brasil', 'brazil', 'sao paulo', 'rio de janeiro', 'belo horizonte', 'porto alegre', 'curitiba',
] as const;

const US = [
  'united states', 'estados unidos', 'ee. uu', 'ee uu', 'usa', 'u.s.', 'us remote', 'remote us',
  'miami', 'new york', 'nueva york', 'nyc', 'austin', 'texas', 'california', 'florida', 'los angeles',
  'san francisco', 'chicago', 'boston', 'seattle', 'denver', 'atlanta', 'dallas', 'houston',
  'phoenix', 'washington dc', 'new jersey', 'las vegas', 'san diego', 'philadelphia',
] as const;

const EUR = /\u20ac|\b(?:eur|euros?|eura?)\b/i;
const USD = /\$|\b(?:usd|us\$|dollars?|dolares?)\b/i;

const hit = (hay: string, words: readonly string[]) => words.some(w => hay.includes(w));

/** Importe en euros o dólares, tal como lo publica el anuncio. `null` si no publica cifra. */
export function currencyOf(...texts: Array<string | null | undefined>): Currency | null {
  const hay = fold(texts.filter(Boolean).join(' '));
  if (!hay) return null;
  // Un anuncio español con «30.000 € (≈ 32.000 $)» es en euros: el euro gana cuando aparecen ambos.
  if (EUR.test(hay)) return 'EUR';
  if (USD.test(hay)) return 'USD';
  return null;
}

/**
 * Mercado de una oferta. `location` manda; la moneda solo decide cuando la ubicación no dice nada
 * (o dice «remoto» a secas, que no es un país). `basis` explica la decisión en el panel: una
 * suposición por moneda se ve distinta de un dato de ubicación.
 */
// «Remoto», «teletrabajo» o «a distancia» no son un país. Sin quitarlos, la señal de España del motor
// (`ES_HINTS` incluye «remoto») convertiría en española cualquier oferta remota de LatAm pagada en dólares.
const REMOTE_WORDS = /\b(?:100%|remoto|remota|remote|teletrabajo|a distancia|home office|desde casa|anywhere|worldwide|global)\b/g;
// Sin plegar acentos: la señal de España del motor busca literalmente «españa».
// Conserva las comas: `placeInSpain` separa por comas y compara cada tramo con el gazetteer.
const placeOnly = (text?: string | null) => (text ?? '').toLowerCase().replace(REMOTE_WORDS, ' ').replace(/[^\p{L}\p{N},.\-]+/gu, ' ').replace(/\s+/g, ' ').replace(/^[\s,.\-]+|[\s,.\-]+$/g, '') || null;

export function marketFor(input: { title?: string | null; location?: string | null; salary?: string | null; description?: string | null }): MarketVerdict {
  const hay = fold(`${input.title ?? ''} ${input.location ?? ''}`);
  const currency = currencyOf(input.salary, input.description);
  if (hit(hay, LATAM)) return { market: 'LATAM', basis: 'ubicacion_latam', currency };
  const spain = spainSignal(placeOnly(input.title), placeOnly(input.location));
  if (spain === true) return { market: 'ES', basis: 'ubicacion_espana', currency };
  if (hit(hay, US)) return { market: 'US_LATINO', basis: 'ubicacion_estados_unidos', currency };
  if (currency === 'USD') return { market: 'US_LATINO', basis: 'moneda_usd', currency };
  if (currency === 'EUR') return { market: 'ES', basis: 'moneda_eur', currency };
  return { market: null, basis: 'sin_senal', currency };
}

export const MARKET_BASIS_LABEL: Record<MarketBasis, string> = {
  ubicacion_espana: 'Ubicación: España',
  ubicacion_latam: 'Ubicación: LatAm',
  ubicacion_estados_unidos: 'Ubicación: EE. UU.',
  moneda_eur: 'Importe en euros (sin ubicación)',
  moneda_usd: 'Importe en dólares (sin ubicación)',
  sin_senal: 'Sin ubicación ni importe',
};

export const MARKET_LABEL: Record<Market, string> = { ES: 'España · Europa', LATAM: 'LatAm', US_LATINO: 'Dólares · LatAm y EE. UU.' };
