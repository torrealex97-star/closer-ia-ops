// Genera apps/web/lib/esPlaces.ts a partir del listado administrativo del INE
// que publica Code for Spain (8.132 municipios). Datos, no lógica: el archivo
// resultante se versiona y se revisa como cualquier otro cambio.
//
// Uso:
//   curl -sL https://raw.githubusercontent.com/codeforspain/ds-organizacion-administrativa/master/data/municipios.csv -o /tmp/mun.csv
//   curl -sL https://raw.githubusercontent.com/codeforspain/ds-organizacion-administrativa/master/data/provincias.csv -o /tmp/prov.csv
//   node scripts/build-es-places.mjs
//
// El worker del motor lleva la misma lista copiada (parity.mjs compara las dos).
import { readFileSync, writeFileSync } from 'node:fs';

const csv = (path) => {
  const text = readFileSync(path, 'utf8').replace(/\r/g, '');
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1);
};

const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const municipalities = csv('/tmp/mun.csv');
const header = municipalities[0];
const nameAt = header.indexOf('nombre');
const provinces = csv('/tmp/prov.csv').slice(1).map(r => r[1]);

const names = new Set();
for (const row of municipalities.slice(1)) {
  const name = row[nameAt];
  if (!name) continue;
  for (const part of name.split('/')) {
    const folded = fold(part);
    if (!folded) continue;
    names.add(folded);
    // Gallego y euskera publican «Rosal, O» / «Coruña, A»; los portales escriben
    // «O Rosal». Se añade la forma natural además de la invertida.
    const inverted = folded.match(/^(.+),\s*(a|o|as|os|el|la|les|los)$/);
    if (inverted) names.add(`${inverted[2]} ${inverted[1]}`);
  }
}
for (const province of provinces) for (const part of province.split('/')) names.add(fold(part));

// Comunidades y formas que usan los portales al publicar la ubicación.
for (const region of [
  'andalucia', 'aragon', 'asturias', 'principado de asturias', 'baleares', 'islas baleares', 'illes balears',
  'canarias', 'cantabria', 'castilla y leon', 'castilla la mancha', 'castilla-la mancha', 'cataluna', 'catalunya',
  'comunidad valenciana', 'comunidad de madrid', 'comunidad foral de navarra', 'extremadura', 'galicia',
  'la rioja', 'region de murcia', 'murcia', 'navarra', 'pais vasco', 'euskadi', 'ceuta', 'melilla',
]) names.add(fold(region));

const list = [...names].sort();
if (list.length < 8000) throw new Error(`lista sospechosamente corta: ${list.length}`);
for (const probe of ['boiro', 'o rosal', 'carballedo', 'cremenes', 'una', 'salou', 'alcobendas', 'murcia']) {
  if (!names.has(probe)) throw new Error(`falta ${probe}`);
}

const file = `import { ES_HINTS, NON_ES_HINTS, fold } from './vocabulary';

// Municipios (8.132), provincias y comunidades de España, plegados y sin duplicados.
// Fuente: listado administrativo del INE que publica Code for Spain
// (codeforspain/ds-organizacion-administrativa). Se genera con
// scripts/build-es-places.mjs; no se edita a mano.
//
// Se compara por SEGMENTO exacto de la ubicación («O Chazo, Boiro» → «boiro»,
// «Marzán, O Rosal» → «o rosal»), nunca por subcadena: «Uña» (Cuenca) se pliega
// a «una», y buscar esa subcadena en un título o una descripción en español
// marcaría cualquier oferta. Por eso los municipios solo miran la ubicación y
// los hints de siempre (España, Madrid, remoto…) siguen como estaban.
export const ES_PLACES = \`${list.join('\n')}\`.split('\\n');

const PLACES = new Set(ES_PLACES);

const segments = (text: string) => fold(text)
  .split(/[,;|()[\\]{}·\\n]+|\\s[-–—]\\s|\\s\\/\\s/)
  .map(part => part.replace(/\\s+/g, ' ').trim())
  .filter(Boolean);

/** ¿La ubicación nombra un municipio, provincia o comunidad de España? */
export function placeInSpain(location: string | null | undefined): boolean {
  if (!location) return false;
  return segments(location).some(part => PLACES.has(part));
}

/** Señal de España a partir de título + ubicación (null = sin ubicación cargada todavía). */
export function spainSignal(title: string | null | undefined, location: string | null | undefined): boolean | null {
  if (!location) return null;
  const hay = \`\${title ?? ''} \${location}\`.toLowerCase();
  if (NON_ES_HINTS.some(k => hay.includes(k))) return false;
  if (ES_HINTS.some(k => hay.includes(k))) return true;
  return placeInSpain(location);
}
`;
writeFileSync('apps/web/lib/esPlaces.ts', file);
console.log(`esPlaces.ts: ${list.length} nombres, ${(file.length / 1024).toFixed(0)} KB`);
writeFileSync('/tmp/es-places.txt', list.join('\n'));
