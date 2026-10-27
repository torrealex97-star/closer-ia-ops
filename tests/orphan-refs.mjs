// Referencias huérfanas: node tests/orphan-refs.mjs
// Falla con un mensaje legible si una prueba llama a una ruta /api que no existe en apps/web/app/api o si run.sh invoca
// un fichero de prueba que no está en el repositorio. Nació de un incidente real: se subieron tests, notas y mocks de la
// actividad de alumnas sin su código, y main estuvo en rojo varios pushes sin que el motivo se viera.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const API = join(ROOT, 'apps/web/app/api');

// Patrones de ruta a partir de los ficheros route.ts: [id] = un segmento, [...id] = el resto.
export function routePatterns(dir = API) {
  const out = [];
  const walk = (current, segments) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(current, entry.name), [...segments, entry.name]);
      else if (/^route\.(ts|js)$/.test(entry.name)) out.push(segments);
    }
  };
  walk(dir, []);
  return out;
}
const matches = (pattern, parts) => {
  for (let i = 0; i < pattern.length; i++) {
    if (/^\[\.\.\..+\]$/.test(pattern[i])) return parts.length > i;
    if (i >= parts.length) return false;
    if (!/^\[.+\]$/.test(pattern[i]) && pattern[i] !== parts[i]) return false;
  }
  return pattern.length === parts.length;
};

// Rutas /api/... citadas como literales en el texto de una prueba (se ignoran las construidas con variables).
export function apiRefs(text) {
  const refs = new Set();
  for (const m of text.matchAll(/['"`](\/api\/[A-Za-z0-9_\-/]*[A-Za-z0-9_-])(?=[?'"`$])/g)) refs.add(m[1]);
  return [...refs];
}
export function missingRoutes(text, patterns) {
  return apiRefs(text).filter(ref => !patterns.some(pattern => matches(pattern, ref.split('/').slice(2))));
}
// Ficheros de prueba que un script invoca: `tests/...` o `spikes/...` con extensión .mjs/.ts/.sh.
export function missingFiles(text, exists = path => existsSync(join(ROOT, path))) {
  const found = new Set([...text.matchAll(/\b((?:tests|spikes)\/[A-Za-z0-9_./-]+\.(?:mjs|ts|sh))\b/g)].map(m => m[1]));
  return [...found].filter(path => !exists(path));
}

// `fileURLToPath(import.meta.url)` y no `file://${argv[1]}`: con espacios en la ruta (este checkout los tiene)
// `import.meta.url` va percent-encoded y la comparación NO coincidía nunca, así que la comprobación principal
// se saltaba en silencio y decía «todo bien» sin mirar nada. El chequeo se prueba a sí mismo en
// `tests/orphan-refs.selftest.mjs`.
if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  const patterns = routePatterns();
  assert.ok(patterns.length > 10, 'no se encontraron rutas en apps/web/app/api: ¿cambió la estructura?');
  const problems = [];
  for (const file of ['tests/admin-auth/flow.mjs', 'tests/admin-auth/ui.mjs']) {
    for (const ref of missingRoutes(readFileSync(join(ROOT, file), 'utf8'), patterns)) problems.push(`${file}: la ruta ${ref} no existe en apps/web/app/api`);
  }
  for (const file of ['tests/admin-auth/run.sh', '.github/workflows/quality.yml']) {
    if (!existsSync(join(ROOT, file))) continue;
    for (const path of missingFiles(readFileSync(join(ROOT, file), 'utf8'))) problems.push(`${file}: invoca ${path}, que no está en el repositorio`);
  }
  if (problems.length) { console.error(`FALLO  referencias huérfanas (¿se subió una prueba sin su código?):\n  - ${problems.join('\n  - ')}`); process.exit(1); }
  console.log(`PASS  sin referencias huérfanas (${patterns.length} rutas de API conocidas)`);
}
