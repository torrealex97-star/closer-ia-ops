// Prueba de exportación CSV: escapado y neutralización de fórmulas. node --experimental-strip-types tests/admin-auth/csv.mjs
import assert from 'node:assert/strict';
import { toCsv } from '../../apps/web/lib/csv.ts';

const csv = toCsv([{ t: 'Closer, senior', c: '=HYPERLINK("http://x")', n: null, q: 'dice "hola"\nmundo' }, { t: '@cmd', c: '-2+3', n: 5, q: 'ok' }],
  [{ header: 'Título', value: r => r.t }, { header: 'Empresa', value: r => r.c }, { header: 'Nº', value: r => r.n }, { header: 'Nota', value: r => r.q }]);
const lines = csv.replace('﻿', '').trim().split('\r\n');
assert.equal(lines[0], 'Título,Empresa,Nº,Nota');
assert.equal(lines[1], '"Closer, senior","\'=HYPERLINK(""http://x"")",,"dice ""hola"" mundo"');
assert.equal(lines[2], "'@cmd,'-2+3,5,ok");
assert.ok(csv.startsWith('﻿'));
console.log('PASS  csv: escapado, saltos de línea y fórmulas neutralizadas');
