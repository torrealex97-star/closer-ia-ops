// Catálogo del panel vs motor: una entrada no puede decir «Requiere configurar» si el motor ya la
// recoge bajo otro código. Es el fallo que dejó a Get on Board como «fuera del cloud» mientras el
// motor la leía cada pasada: dos entradas para el mismo portal y solo una cruzaba.
// Uso: node --experimental-strip-types tests/engine/catalog.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-catalog-')), 'worker.mjs');
copyFileSync(fileURLToPath(new URL('sites/engine/worker.js', root)), stage);
const { __test } = await import(pathToFileURL(stage).href);
const { catalogCodeFor, groupByFamily } = await import(pathToFileURL(fileURLToPath(new URL('apps/web/lib/sourceFamilies.ts', root))).href);
const catalog = (await import(fileURLToPath(new URL('apps/web/lib/sourceCatalog.json', root)), { with: { type: 'json' } })).default;

// Lo mismo que hace el panel: agrupar los conectores del motor por portal y cruzarlos por código.
const cloud = groupByFamily(__test.SOURCES.map(s => ({
  code: s.code, name: s.code, run_status: 'completed', fetched: 0, catalog: 0, eligible: 0, selected: 0, warning: null,
})));

// 1) Códigos únicos: dos entradas con el mismo código hacen que una tape a la otra en la tabla.
const codes = catalog.map(c => c.code);
assert.equal(new Set(codes).size, codes.length, `códigos duplicados en el catálogo: ${codes.filter((c, i) => codes.indexOf(c) !== i).join(', ')}`);

// 2) Ninguna entrada puede pedir configuración si su portal ya está en el motor.
const lying = catalog.filter(c => c.requires === 'input' && cloud.has(catalogCodeFor(c.code)));
assert.deepEqual(lying.map(c => c.code), [], 'entradas que dicen «Requiere configurar» y el motor ya recoge');

// 3) Y al revés: una entrada libre que el portal recoge no debe anunciar un proveedor pendiente.
const stale = catalog.filter(c => cloud.has(c.code) && c.requires !== 'input' && /pendiente|Sin proveedor/i.test(`${c.acquisition_method} ${c.validation_status}`));
assert.deepEqual(stale.map(c => c.code), [], 'entradas recogidas que aún dicen «Adaptador pendiente / Sin proveedor verificado»');

// 4) El recuento que ve el operador: entradas del catálogo que el panel marca como recogidas.
const connected = catalog.filter(c => cloud.has(c.code));
assert.equal(connected.length, 27, `entradas conectadas esperadas 27, hay ${connected.length}: ${connected.map(c => c.code).join(', ')}`);
assert.equal(catalog.length, 65, `el catálogo tiene 65 entradas, hay ${catalog.length}`);

console.log('PASS  catálogo sin duplicados engañosos: 65 entradas, 27 conectadas y ninguna que pida configurar lo que el motor ya recoge');
