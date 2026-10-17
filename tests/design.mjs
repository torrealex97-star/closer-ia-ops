// Regla de colores como tokens: node tests/design.mjs
import assert from 'node:assert/strict';
import { findHex } from '../scripts/check-design.mjs';
assert.deepEqual(findHex(`<div style={{ color: '#8d463d' }} />`).map(h => h.color), ['#8d463d']);
assert.deepEqual(findHex(`const a = "#fff"; const b = '#FFFFFF80';`).map(h => h.color), ['#fff', '#FFFFFF80']);
assert.deepEqual(findHex(`<a href="#contenido">Ir</a>`), [], 'anclas permitidas');
assert.deepEqual(findHex(`texto &#39; apóstrofo`), [], 'entidades HTML permitidas');
assert.deepEqual(findHex(`style={{ color: 'var(--accent)' }}`), []);
assert.deepEqual(findHex(`const x = 1; // #fff en un comentario`), [], 'comentarios de línea ignorados');
assert.equal(findHex('a\nb { background:#123456 }')[0].line, 2);
console.log('PASS  diseño: detecta hex fuera de tokens y respeta anclas, entidades y var(--…)');
