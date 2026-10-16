// Compensación literal del texto de una oferta. JobSpy solo extrae salario del texto para EE. UU. (en euros no),
// así que aquí se rescata la frase tal como aparece, y solo con importe en € y periodo o «bruto/neto» a continuación.
// Se devuelve el texto literal, nunca un número calculado. Bonus, comisiones, inversiones o facturación no cuentan.
const NUM = String.raw`(?:\d{1,3}(?:[.\s]\d{3})+|\d{3,6}|\d{2,3}\s?[kK])`;
const CUR = String.raw`(?:€|eur(?:os)?\b)`;
const AMOUNT = new RegExp(String.raw`${NUM}\s?${CUR}?(?:\s?(?:-|–|—|a|y|hasta)\s?${NUM}\s?${CUR}?)?\s?${CUR}`, 'gi');
const TOKEN = String.raw`(?:brut[oa]s?|net[oa]s?|anual(?:es)?|mensual(?:es)?|(?:al|por)\s+(?:a[ñn]o|mes)\b|\/\s?(?:a[ñn]o|mes)\b)`;
const PERIOD = new RegExp(String.raw`^\s*${TOKEN}(?:\s?\/?\s?${TOKEN})*`, 'i');
const NOT_SALARY = /(bonus|bono|comision|incentivo|variable|facturaci|inversi|ingresos?\s+(?:de\s+)?(?:hasta|medios)|ganancias?|cliente|ventas\s+de)\W{0,3}[^.\n]{0,25}$/i;

const toNumber = (raw: string) => {
  const k = /k$/i.test(raw.trim());
  const n = Number(raw.replace(/[kK\s]/g, '').replace(/\./g, ''));
  return k ? n * 1000 : n;
};

export function salaryFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ');
  for (const m of flat.matchAll(AMOUNT)) {
    const start = m.index ?? 0, end = start + m[0].length;
    const period = PERIOD.exec(flat.slice(end, end + 45));
    if (!period) continue;
    const amounts = (m[0].match(new RegExp(NUM, 'g')) ?? []).map(toNumber);
    if (!amounts.length || amounts.some(n => n < 400 || n > 500000)) continue; // fuera de lo plausible para un sueldo
    if (NOT_SALARY.test(flat.slice(Math.max(0, start - 40), start))) continue;
    return flat.slice(start, end + period[0].length).trim().slice(0, 90);
  }
  return null;
}
