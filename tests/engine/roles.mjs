// Categorías de rol: «comercial» genérico y «teleoperador» tienen que caer en su familia.
// Medido 2026-11-12 sobre las 1.540 retiradas por «sin perfil comercial reconocible»: 633 mencionan
// «comercial» (título tipo «Comercial Junior Automatización») y 64 «teleoperador», que estaba
// únicamente como 'teleoperador comercial' dentro de setter.
// Ampliación 2026-11-13: «Business Developer» es cierre (closer) y ADR/BDR son agenda (setter), con
// los negativos que importan: ni mandos ni customer success entran por estas palabras.
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

// ---- Business Developer = cierre ----
assert.equal(role('Business Developer'), 'closer');
assert.equal(role('Business Developer B2B (remoto)'), 'closer');
assert.equal(role('Business Developers High Ticket'), 'closer');
// Y no se traga al mando: «development» no es «developer», hasWord exige palabra completa.
assert.equal(role('Business Development Manager'), 'account_executive');
assert.equal(role('Head of Business Development'), null);
assert.equal(role('Director de Business Development'), null);

// ---- ADR/BDR = setter (abren la reunión, no cierran) ----
assert.equal(role('ADR'), 'setter');
assert.equal(role('BDR'), 'setter');
assert.equal(role('BDR / SDR'), 'setter', 'con las dos siglas gana el orden de evaluación: setter');
assert.equal(role('Account Development Representative'), 'setter');
assert.equal(role('Business Development Representative'), 'setter');
assert.equal(role('Appointment Development Representative (ADR)'), 'setter');
assert.equal(role('SDR'), 'sdr');
// La sigla va por palabra completa: «Madrid» lleva las letras «adr» y no es un ADR.
assert.equal(role('Comercial Madrid'), 'account_executive');
assert.equal(role('Business Development Representative Madrid'), 'setter');

// ---- Lo que no debe entrar por estas palabras nuevas ----
assert.equal(role('Customer Success Manager'), null);
assert.equal(role('Customer Success Specialist'), null);
assert.equal(role('Customer Success Representative'), null);
assert.equal(role('Sales Manager'), null);
assert.equal(role('Key Account Manager'), 'account_executive', 'cuentas sí; «manager» no lo salva de ser venta');

// La evidencia en el cuerpo sigue funcionando para las palabras nuevas.
assert.equal(classifyRole({ title: 'Gestor de cuentas' }, 'buscamos business developer para cerrar ventas high ticket'), 'closer');
assert.equal(classifyRole({ title: 'Gestor de cuentas' }, 'equipo de bdr y adr para agendar demos'), 'setter');

console.log('PASS  categorías de rol (31 casos)');
