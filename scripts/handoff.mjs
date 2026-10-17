#!/usr/bin/env node
// Tablero de relevo entre agentes: una ficha por trabajo vivo en docs/handoff/claims/*.md (así dos agentes no editan el
// mismo fichero ni chocan en el merge). `list` imprime el tablero; `check` falla si una ficha está mal formada, si dos
// trabajos vivos tocan lo mismo sin declarar dependencia, o si un agente tiene dos trabajos `in_progress` a la vez.
// (Varios `validated` del mismo agente esperando revisión del dueño sí se permiten: la cola de revisión no es trabajo en curso.)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUSES = ['in_progress', 'validated', 'blocked'];
const REQUIRED = ['agent', 'status', 'branch', 'touches', 'date'];

export function parseClaim(text, name) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return { name, errors: ['sin cabecera ---'] };
  const f = {};
  for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) f[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  const errors = REQUIRED.filter(k => !f[k]).map(k => `falta ${k}`);
  if (f.status && !STATUSES.includes(f.status)) errors.push(`status inválido: ${f.status}`);
  if (f.date && !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) errors.push('date debe ser AAAA-MM-DD');
  const split = v => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return { name, agent: f.agent, status: f.status, branch: f.branch, pr: f.pr, date: f.date, touches: split(f.touches), dependsOn: split(f.depends_on), errors };
}

const overlaps = (a, b) => a === b || a.startsWith(b.endsWith('/') ? b : `${b}/`) || b.startsWith(a.endsWith('/') ? a : `${a}/`);

export function check(claims) {
  const problems = [];
  for (const c of claims) for (const e of c.errors) problems.push(`${c.name}: ${e}`);
  const ok = claims.filter(c => !c.errors.length);
  const byName = new Map(ok.map(c => [c.name, c]));
  for (const c of ok) for (const d of c.dependsOn) if (!byName.has(d)) problems.push(`${c.name}: depends_on desconocido (${d})`);
  const related = (a, b) => {
    const reach = (from, to, seen = new Set()) => from.dependsOn.some(d => d === to.name || (!seen.has(d) && byName.has(d) && reach(byName.get(d), to, seen.add(d))));
    return reach(a, b) || reach(b, a);
  };
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
    const a = ok[i], b = ok[j];
    if (related(a, b)) continue;
    if (a.agent === b.agent && a.status === 'in_progress' && b.status === 'in_progress') problems.push(`${a.name} y ${b.name}: el agente ${a.agent} tiene dos trabajos in_progress sin cadena depends_on (un trabajo en curso por agente)`);
    for (const x of a.touches) for (const y of b.touches) if (overlaps(x, y)) problems.push(`${a.name} y ${b.name}: ambos tocan ${x === y ? x : `${x} / ${y}`}`);
  }
  return problems;
}

export function board(claims) {
  const rows = claims.filter(c => !c.errors.length).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return ['| Agente | Estado | Rama | PR | Toca | Desde |', '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(c => `| ${c.agent} | ${c.status} | \`${c.branch}\` | ${c.pr ? `#${c.pr}` : '—'} | ${c.touches.join(', ')} | ${c.date} |`)].join('\n');
}

export function load(dir) {
  return readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md').sort().map(f => parseClaim(readFileSync(join(dir, f), 'utf8'), f.replace(/\.md$/, '')));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL('../docs/handoff/claims/', import.meta.url).pathname;
  const claims = load(dir);
  if (process.argv[2] === 'list') { console.log(board(claims)); }
  else if (process.argv[2] === 'check') {
    const problems = check(claims);
    if (problems.length) { console.error(problems.map(p => `✗ ${p}`).join('\n')); process.exit(1); }
    console.log(`Relevo OK: ${claims.length} trabajo(s) vivo(s), sin solapes.`);
  } else { console.error('Uso: node scripts/handoff.mjs list|check'); process.exit(2); }
}
