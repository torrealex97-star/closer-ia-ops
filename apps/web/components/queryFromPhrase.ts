import type { components } from '../../../packages/contracts/api';

export type Query = components['schemas']['OpportunityQuery'];
export type Role = NonNullable<Query['role']>;

export type PhraseResult = {
  query: Query;
  matched: string[];
  unsupported: string[];
  saved: boolean;
};

// Sin LLM: la frase se traduce a los mismos filtros reales del formulario.
// Solo se reconoce lo que el catálogo puede filtrar; lo demás se dice, no se adivina.
const norm = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const ROLES: Array<{ role: Role; label: string; test: RegExp }> = [
  { role: 'closer', label: 'perfil Closer', test: /\bclosers?\b|\bcerrador(?:a|as|es)?\b/ },
  { role: 'setter', label: 'perfil Setter', test: /\bsetters?\b/ },
  { role: 'cold_caller', label: 'perfil Cold Caller', test: /\bcold ?callers?\b|\bllamadas frias\b|\bteleoperador(?:a|as|es)?\b/ },
  { role: 'account_executive', label: 'perfil Ejecutivo comercial', test: /\baccount executives?\b|\bejecutiv[oa]s? comercial(?:es)?\b|\basesor(?:a|as|es)? comercial(?:es)?\b/ },
  { role: 'sdr', label: 'perfil SDR / BDR', test: /\bsdr\b|\bbdr\b/ },
];

const MARKETS: Array<{ market: Exclude<Query['market'], 'any'>; label: string; test: RegExp }> = [
  { market: 'ES', label: 'España', test: /\bespana\b|\besp\b|\bspain\b|\bnacional\b/ },
  { market: 'EU', label: 'Europa', test: /\beuropa\b|\beu\b|\beurope\b/ },
  { market: 'LATAM', label: 'Latinoamérica', test: /\blatam\b|\blatinoamerica\b|\bamerica latina\b/ },
  { market: 'US', label: 'Estados Unidos', test: /\bestados unidos\b|\bee\.?\s?uu\b|\beeuu\b|\busa\b|\bunited states\b/ },
];

const WINDOWS: Array<{ days: number; label: string; test: RegExp }> = [
  { days: 1, label: 'últimas 24 horas', test: /\bhoy\b|\bultimas 24\b|\b24 horas?\b/ },
  { days: 3, label: 'últimos 3 días', test: /\b3 dias\b|\btres dias\b/ },
  { days: 7, label: 'últimos 7 días', test: /\besta semana\b|\bsemana\b|\b7 dias\b|\bsiete dias\b/ },
  { days: 10, label: 'últimos 10 días', test: /\b10 dias\b|\bdiez dias\b/ },
];

export function parsePhrase(text: string, base: Query): PhraseResult {
  const value = norm(text).trim();
  const matched: string[] = [];
  const unsupported: string[] = [];
  const query: Query = { ...base };
  // Guardar es una vista, no un filtro del catálogo: se declara aparte.
  const saved = /\bguardadas?\b|\bfavoritas?\b/.test(value);
  if (!value) return { query, matched, unsupported, saved };
  const role = ROLES.find(candidate => candidate.test.test(value));
  if (role) { query.role = role.role; matched.push(role.label); }
  const market = MARKETS.find(candidate => candidate.test.test(value));
  if (market) { query.market = market.market; matched.push(market.label); }
  const window = WINDOWS.find(candidate => candidate.test.test(value));
  if (window) { query.days = window.days; matched.push(window.label); }
  if (/\bbilingues?\b|\bingles\b|\benglish\b/.test(value)) { query.include_bilingual = true; matched.push('también bilingües'); }
  else if (/\bsolo (en )?espanol\b/.test(value)) { query.include_bilingual = false; matched.push('solo en español'); }
  if (/\bremot[oa]s?\b|\bpresencial(?:es)?\b|\bhibrid[oa]s?\b/.test(value)) unsupported.push('la modalidad: cada oferta ya indica si es remota, híbrida o presencial');
  if (/\bayer\b|\bmes\b|\b30 dias\b/.test(value)) unsupported.push('ese periodo: el catálogo filtra por 24 horas, 3, 7 o 10 días');
  return { query, matched, unsupported, saved };
}
