// Guarda para repositorio público: ningún fichero versionado contiene una clave o credencial reconocible.
// node tests/secrets.mjs   (se ejecuta dentro de tests/admin-auth/run.sh, es decir, en el CI)
// Es una red de seguridad por patrones, NO sustituye a Secret scanning de GitHub ni a gitleaks/trufflehog.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

export const PATTERNS = [
  ['clave tipo sk-', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['clave Stripe live', /\b[sr]k_live_[A-Za-z0-9]{10,}/],
  ['clave de Groq', /\bgsk_[A-Za-z0-9]{20,}/],
  ['clave de Resend', /\bre_[A-Za-z0-9]{24,}/],
  ['token de Apify', /\bapify_api_[A-Za-z0-9]{15,}/],
  ['clave de Supabase', /\bsb_(secret|publishable)_[A-Za-z0-9_-]{15,}/],
  // Cabecera.carga.firma de un JWT (p. ej. la service_role de Supabase): la cabecera estándar mide ~36 caracteres, no 50.
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['token de GitHub', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['token de Slack', /\bxox[abp]-[A-Za-z0-9-]{10,}/],
  ['clave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  // Sin \b delante: así también casan CRON_SECRET, GROQ_API_KEY o adminToken, no solo `token = "…"`.
  ['asignación de secreto', /(password|passwd|secret|token|api_?key)["']?\s*[:=]\s*["'][A-Za-z0-9/+_-]{24,}["']/i],
];

// Valores de relleno de las pruebas (claves falsas del CI): no son secretos.
const PLACEHOLDER = /(fake|fixture|dummy|example|placeholder|test|0123456789|x{4,}|ingest-token|cron-secret|good-key|bad-key|tu-clave|your[-_ ]?key)/i;

export function scanText(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of PATTERNS) {
      const m = re.exec(line);
      if (m && !PLACEHOLDER.test(m[0])) hits.push({ name, line: i + 1 });
    }
  });
  return hits;
}

// Autoprueba: el escáner detecta lo que debe y no se queja de lo normal.
const fake = (s) => s; // los ejemplos se construyen por partes para que este fichero no contenga claves reales
assert.equal(scanText(fake('const k = "' + 'gsk_' + 'a'.repeat(30) + '"')).length > 0, true);
assert.equal(scanText(fake('x = "' + 'sk-' + 'b'.repeat(30) + '"')).length > 0, true);
assert.equal(scanText('-----BEGIN ' + 'PRIVATE KEY-----').length > 0, true);
assert.equal(scanText('const apiKey = process.env.GROQ_API_KEY;').length, 0);
assert.equal(scanText("token: 'fake-classification-secret-value'").length, 0); // relleno de pruebas
assert.equal(scanText('const token = "' + 'Zq8' + 'T'.repeat(30) + '"').length > 0, true); // un valor real sí
assert.equal(scanText('// GROQ_API_KEY=… (opcional)').length, 0);
// Un JWT con la cabecera estándar y los nombres de variable con prefijo también se detectan.
assert.equal(scanText('k = "' + 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' + '.' + 'eyJyb2xlIjoic2VydmljZV9yb2xlIn0' + '.' + 'Zq8T'.repeat(5) + '"').length > 0, true);
assert.equal(scanText('const GROQ_API_KEY = "' + 'Zq8' + 'T'.repeat(30) + '"').length > 0, true);
assert.equal(scanText('CRON_SECRET: "' + 'Zq8' + 'T'.repeat(30) + '"').length > 0, true);

// Los datos de prueba con claves falsas del propio CI (p. ej. «good-key-1234») no encajan en ningún patrón.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  .filter(f => !/\.(png|jpg|jpeg|gif|ico|woff2?|pdf|lock)$|package-lock\.json$|^tests\/secrets\.mjs$/.test(f));
const found = [];
for (const file of files) {
  let text; try { text = readFileSync(file, 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue;
  for (const hit of scanText(text)) found.push(`${file}:${hit.line} (${hit.name})`);
}
assert.deepEqual(found, [], `posibles secretos versionados:\n${found.join('\n')}`);
console.log(`PASS  sin secretos reconocibles en ${files.length} ficheros versionados`);
