#!/usr/bin/env node
// Regla de diseño: los colores viven como tokens en apps/web/app/globals.css (:root). Falla si aparece un color hex en
// componentes o rutas (excepto enlaces ancla `href="#…"`). Uso: node scripts/check-design.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEX = /(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g;
export function findHex(source) {
  const hits = [];
  source.split('\n').forEach((line, i) => {
    const clean = line.replace(/href=(["'])#[^"']*\1/g, '').replace(/\/\/.*$/, '');
    for (const m of clean.matchAll(HEX)) hits.push({ line: i + 1, color: m[0] });
  });
  return hits;
}
function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f === '.next') continue;
    if (statSync(p).isDirectory()) yield* walk(p); else if (/\.(tsx|ts|jsx|js)$/.test(f)) yield p;
  }
}
// --muted (contraste 3,4:1) NO cumple AA para texto: en CSS solo se permite en `.icon-button`; en componentes, nunca.
export function findMutedText(css) {
  const hits = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (/color:\s*var\(--muted\)/.test(m[2]) && !/\.icon-button\b/.test(m[1])) hits.push(m[1].trim());
  return hits;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // fileURLToPath y no `.pathname`: en una ruta con espacios (`VIBE APPS`) el pathname llega
  // escapado (`%20`) y el recorrido fallaba con ENOENT antes de mirar un solo archivo.
  const root = fileURLToPath(new URL('../apps/web/', import.meta.url));
  const bad = [];
  for (const dir of ['components', 'app']) for (const file of walk(join(root, dir))) for (const h of findHex(readFileSync(file, 'utf8'))) bad.push(`${file.replace(root, '')}:${h.line} ${h.color}`);
  for (const sel of findMutedText(readFileSync(join(root, 'app/globals.css'), 'utf8'))) bad.push(`app/globals.css: ${sel} usa --muted en texto (usa var(--secondary))`);
  for (const dir of ['components', 'app']) for (const file of walk(join(root, dir))) if (/var\(--muted\)/.test(readFileSync(file, 'utf8'))) bad.push(`${file.replace(root, '')}: usa var(--muted) en texto`);
  if (bad.length) { console.error(`✗ Colores hex fuera de los tokens (usa var(--…) de globals.css):\n${bad.join('\n')}`); process.exit(1); }
  console.log('Diseño OK: ningún color hex fuera de los tokens.');
}
