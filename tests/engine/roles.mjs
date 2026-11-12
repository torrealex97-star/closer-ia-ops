// Categorías de rol: «comercial» genérico y «teleoperador» tienen que caer en su familia.
// Medido 2026-11-12 sobre las 1.540 retiradas por «sin perfil comercial reconocible»: 633 mencionan
// «comercial» (título tipo «Comercial Junior Automatización») y 64 «teleoperador», que estaba
// únicamente como 'teleoperador comercial' dentro de setter.
// Uso: node --experimental-strip-types tests/engine/roles.mjs   (sin red ni Cloudflare)
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-roles-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const { __test } = await import(pathToFileURL(stage).href);
const { classifyRole } = __test;
const role = title => classifyRole({ title }, '');

assert.equal(role('Teleoperador comercial'), 'cold_caller');
assert.equal(role('Teleoperadora turno tarde'), 'cold_caller');
assert.equal(role('Comercial Junior Automatización'), 'account_executive');
assert.equal(role('Comercial telefónico'), 'account_executive');
assert.equal(role('Closer de ventas high ticket'), 'closer');
assert.equal(role('Setter y Closer de ventas'), 'closer');
assert.equal(role('Asesor/a de Ventas'), 'account_executive');
// Los puestos que NO son del perfil siguen fuera: ni retail, ni análisis, ni gestión.
assert.equal(role('Sales Planning Sr Analyst'), null);
assert.equal(role('Retail Sales Associate'), null);
assert.equal(role('Gerente Regional de Ventas (Retail)'), null);

console.log('PASS  categorías de rol (10 casos)');
