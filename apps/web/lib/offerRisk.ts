import { fold } from './vocabulary';

// Detector de ofertas peligrosas: reglas deterministas sobre el texto del anuncio, sin red ni IA.
// Solo ve lo que el anuncio DICE: no comprueba CIF, antigüedad del dominio ni LinkedIn (eso exige
// consultas externas y queda como pendiente). Una oferta sin banderas es «sin señales», no «segura».
// Una bandera crítica bloquea; cualquier otra avisa y deja la decisión a una persona.
export type Severity = 'CRITICAL' | 'WARNING';
export type RiskFlag = { code: string; severity: Severity; description: string };
export type RiskLevel = 'SAFE' | 'WARNING' | 'BLOCKED';
export type RiskAssessment = { risk_score: number; risk_level: RiskLevel; detected_flags: RiskFlag[]; visibility: boolean };
export type RiskInput = { title?: string | null; description?: string | null; salary?: string | null };

const BLOCK_SCORE = 85;
const WEIGHT: Record<Severity, number> = { CRITICAL: 85, WARNING: 30 };

type Rule = { code: string; severity: Severity; description: string; test: (text: string) => boolean };

// Una coincidencia negada en su misma frase («no es necesario pagar», «sin inversión inicial») es justo lo contrario de la bandera.
const NEGATION = /\b(?:no|sin|nunca|jamas|ni|ningun[oa]?|tampoco)\b/;
// Si quien asume el coste es la empresa («la empresa asume la inversión en publicidad»), tampoco es una carga para la closer.
const COMPANY_PAYS = /\b(?:la empresa|nuestra empresa|la compania|nosotros|nosotras|el cliente)\b/;
const unnegated = (text: string, re: RegExp, skip?: RegExp) => {
  for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
    const clause = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0).split(/[.,;:!?\n]/).pop() ?? '';
    if (!NEGATION.test(clause) && !(skip && skip.test(clause))) return true;
  }
  return false;
};

const AMOUNT = /(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\s*(?:€|eur\b|euros?)\s*(?:(?:\/|al|por|x)\s*mes\b|mensuales?\b)/g;
const amounts = (text: string) => [...text.matchAll(AMOUNT)].map(m => Number(m[1].replace(/[.,]/g, ''))).filter(n => Number.isFinite(n));

const RULES: Rule[] = [
  { code: 'ADVANCE_PAYMENT_DETECTED', severity: 'CRITICAL', description: 'La oferta pide un pago o una compra previa (formación, licencia, kit, cuota) para empezar.',
    test: t => [
      /\b(?:debes|tienes que|deberas|es necesario|es obligatorio|hay que)\s+(?:pagar|abonar|invertir|comprar|adquirir)\b/,
      /\b(?:pago|cuota|inversion|matricula|deposito)\s+(?:inicial|previ[oa]|por adelantado|de entrada)\b/,
      /\b(?:compra|adquisicion)\s+(?:de|del)\s+(?:un\s+|el\s+)?(?:kit|curso|licencia|paquete|material|formacion)\b/,
      /\b(?:formacion|curso|licencia)\s+(?:de pago|obligatori[ao]\s+de pago|a tu cargo)\b/,
    ].some(re => unnegated(t, re)) },
  { code: 'MLM_OR_PYRAMID', severity: 'CRITICAL', description: 'Parece multinivel o venta piramidal: la meta es reclutar, no vender un producto o servicio.',
    test: t => /\b(?:multinivel|network marketing|marketing de red|piramid(?:al|e)|linea descendente|ponzi)\b/.test(t)
      || (/\breclut\w*\b/.test(t) && /\b(?:tu propi[oa] (?:red|equipo)|comisiones? por (?:cada )?(?:persona|referid\w+|reclutad\w+))\b/.test(t)) },
  { code: 'UNREALISTIC_INCOME', severity: 'CRITICAL', description: 'Promete ingresos muy altos sin experiencia o desde el primer momento.',
    test: t => {
      const big = amounts(t).some(n => n >= 8000);
      return big && /\b(?:sin experiencia|desde la primera semana|desde el primer mes|primer mes|sin conocimientos)\b/.test(t);
    } },
  { code: 'INCOME_CLAIM', severity: 'WARNING', description: 'Promete ingresos muy altos o «libertad financiera»: pide el contrato y las condiciones por escrito.',
    test: t => amounts(t).some(n => n >= 10000) || /\b(?:libertad financiera|dinero facil|ingresos ilimitados|sin limite de ingresos|hazte rico)\b/.test(t) },
  { code: 'COMMISSION_ONLY', severity: 'WARNING', description: 'Solo comisión, sin fijo: confirma cómo se consiguen los leads antes de aceptar.',
    test: t => /\b(?:100\s*%\s*(?:a\s+)?comision|solo comision(?:es)?|unicamente comision(?:es)?|comision pura|sin (?:sueldo|salario) fijo|sin fijo)\b/.test(t) },
  { code: 'AD_SPEND_ON_CLOSER', severity: 'WARNING', description: 'Pide que la closer asuma la inversión en publicidad.',
    test: t => unnegated(t, /\b(?:inversion|pagar|costear|asumir|financiar)\b.{0,30}\b(?:publicidad|anuncios|ads)\b/, COMPANY_PAYS) },
  { code: 'NO_INTERVIEW', severity: 'WARNING', description: 'Contratación inmediata o sin entrevista formal.',
    test: t => /\b(?:sin entrevista|contratacion inmediata|incorporacion inmediata sin|empieza hoy mismo|empiezas hoy)\b/.test(t) },
  { code: 'MESSAGING_ONLY_CONTACT', severity: 'WARNING', description: 'El único contacto es WhatsApp o Telegram.',
    test: t => /\b(?:escribe|contacta|escribenos|envia(?:nos)?(?:\s+un)?\s+mensaje)\b.{0,30}\b(?:whatsapp|telegram)\b/.test(t) && !/@|\bwww\.|https?:/.test(t) },
];

/** Evalúa una oferta con el texto que trae. Determinista: el mismo texto da siempre el mismo resultado. */
export function assessOffer(offer: RiskInput): RiskAssessment {
  const text = fold(`${offer.title ?? ''}\n${offer.description ?? ''}\n${offer.salary ?? ''}`);
  const detected_flags: RiskFlag[] = RULES.filter(rule => rule.test(text)).map(({ code, severity, description }) => ({ code, severity, description }));
  const risk_score = Math.min(100, detected_flags.reduce((sum, flag) => sum + WEIGHT[flag.severity], 0));
  const critical = detected_flags.some(flag => flag.severity === 'CRITICAL');
  const risk_level: RiskLevel = critical || risk_score >= BLOCK_SCORE ? 'BLOCKED' : detected_flags.length ? 'WARNING' : 'SAFE';
  return { risk_score, risk_level, detected_flags, visibility: risk_level !== 'BLOCKED' };
}
