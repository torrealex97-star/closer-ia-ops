#!/usr/bin/env node
// Exporta el catálogo del motor a un .sql importable con `wrangler d1 execute --file`.
//
// Para qué: mover el motor a una cuenta propia de Cloudflare (ADR-018). La D1 de hoy vive en una
// cuenta gestionada, así que la única vía de sacar los datos es la ruta `/api/export` del propio
// Worker (solo `ADMIN_TOKEN`, solo lectura y paginada por clave).
//
// Uso:
//   ENGINE_URL=https://<motor> ENGINE_ADMIN_TOKEN=<token> node scripts/engine-export.mjs [--out engine-dump.sql]
//
// Qué NO hace: no toca la base de origen (no escribe), no trae `write_ledger` (la cuota es de la
// cuenta, heredarla sería contar como gastado lo que la cuenta nueva todavía no ha escrito) y no
// inventa filas: si una tabla falla, se para y se declara, en vez de dejar un volcado a medias que
// parezca completo.
import { appendFileSync, writeFileSync } from 'node:fs';

const TABLES = [
  // Padres antes que hijos, para que el archivo se lea en orden y un humano pueda revisarlo.
  'raw_items', 'job_postings', 'jobs', 'catalog_entries', 'opportunities', 'opportunity_versions',
  'collection_runs', 'verification_events', 'slug_audit',
];
const PAGE = 200;

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : 'engine-dump.sql';
const base = (process.env.ENGINE_URL ?? '').replace(/\/$/, '');
const token = process.env.ENGINE_ADMIN_TOKEN ?? '';
if (!base || !token) {
  console.error('Faltan ENGINE_URL y/o ENGINE_ADMIN_TOKEN. Uso: ENGINE_URL=https://<motor> ENGINE_ADMIN_TOKEN=<token> node scripts/engine-export.mjs [--out engine-dump.sql]');
  process.exit(2);
}

const page = async (table, after) => {
  const url = `${base}/api/export?table=${encodeURIComponent(table)}&limit=${PAGE}&after=${encodeURIComponent(after)}`;
  const response = await fetch(url, { headers: { 'X-Admin-Token': token } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${table}: HTTP ${response.status} ${body.detail ?? ''}`.trim());
  return body;
};

console.log(`Exportando ${TABLES.length} tablas desde ${base} → ${out}`);
writeFileSync(out, `-- Volcado del motor (${new Date().toISOString()})\n-- Importar DESPUÉS de que el Worker nuevo haya creado el esquema (/api/status).\n-- No incluye write_ledger: la cuota es de la cuenta, no del catálogo.\n`);
const summary = [];
for (const table of TABLES) {
  let after = '';
  let rows = 0;
  let pages = 0;
  for (;;) {
    const body = await page(table, after);
    if (body.sql) appendFileSync(out, `${body.sql}\n`);
    rows += Number(body.rows) || 0;
    pages += 1;
    if (!body.next) break;
    after = body.next;
  }
  summary.push({ table, rows, pages });
  console.log(`  ${table.padEnd(22)} ${String(rows).padStart(7)} filas · ${pages} página(s)`);
}

const total = summary.reduce((sum, item) => sum + item.rows, 0);
console.log(`\nListo: ${total} filas en ${out}. Importa con:`);
console.log(`  npx wrangler d1 execute <DB> --remote --file=${out}`);
console.log('Comprueba después /api/status del Worker nuevo: raw_items y catalog_active tienen que cuadrar con el origen.');
