// Topes de la sala de práctica: la IP del limitador no puede venir de un valor que elija el cliente y el mapa de
// turnos tiene tope duro. node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/practicebudget.mjs
import assert from 'node:assert/strict';
import { MAX_KEYS, clientIp, createTurnBudget } from '../../apps/web/lib/practiceBudget.ts';

const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };
const headers = entries => ({ get: name => entries[name.toLowerCase()] ?? null });

step('la IP del tope usa `x-real-ip` (no falseable) antes que la cadena de proxies', () => {
  assert.equal(clientIp(headers({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '1.2.3.4' })), '198.51.100.7');
  assert.equal(clientIp(headers({ 'x-real-ip': ' 198.51.100.7 ' })), '198.51.100.7', 'se recorta el espacio');
});
step('sin `x-real-ip` se toma la ÚLTIMA entrada de `x-forwarded-for`, no la que escribe el cliente', () => {
  // El cliente manda «9.9.9.9» y el proxy inmediato añade la IP real al final: se cuenta la real.
  assert.equal(clientIp(headers({ 'x-forwarded-for': '9.9.9.9, 203.0.113.5' })), '203.0.113.5');
  assert.equal(clientIp(headers({ 'x-forwarded-for': '203.0.113.5' })), '203.0.113.5');
  assert.equal(clientIp(headers({})), 'local', 'sin cabeceras hay una clave estable, no una por petición');
  assert.equal(clientIp(headers({ 'x-forwarded-for': ' , ' })), 'local');
});
step('una IP falseada distinta en cada petición no da cuota nueva: la clave es la real', () => {
  const budget = createTurnBudget();
  const ip = '203.0.113.5';
  assert.equal(budget.spend(`ip:${ip}`, 2), 1);
  assert.equal(budget.spend(`ip:${clientIp(headers({ 'x-forwarded-for': '9.9.9.9', 'x-real-ip': '203.0.113.5' }))}`, 2), 0);
  assert.equal(budget.spend(`ip:${ip}`, 2), null, 'agotada a los dos turnos');
});
step('los topes son independientes por clave y el día nuevo reinicia', () => {
  let day = '2026-10-26T09:00:00.000Z';
  const budget = createTurnBudget({ now: () => new Date(day) });
  assert.equal(budget.spend('ip:a', 1), 0);
  assert.equal(budget.spend('ip:b', 1), 0, 'otra IP tiene su propia cuota');
  assert.equal(budget.spend('ip:a', 1), null);
  day = '2026-10-27T00:05:00.000Z';
  assert.equal(budget.spend('ip:a', 1), 0, 'al día siguiente vuelve a haber cuota');
});
step('el mapa de turnos no crece sin fin con claves inventadas', () => {
  const budget = createTurnBudget();
  for (let i = 0; i < MAX_KEYS + 250; i++) budget.spend(`ip:10.0.0.${i}`, 5);
  assert.ok(budget.size <= MAX_KEYS, `tamaño ${budget.size} > ${MAX_KEYS}`);
});
step('al depurar claves, el tope global del día no se pierde', () => {
  let day = '2026-10-26T09:00:00.000Z';
  const budget = createTurnBudget({ now: () => new Date(day) });
  assert.equal(budget.spend('global', 40), 39);
  for (let i = 0; i < MAX_KEYS + 250; i++) budget.spend(`ip:10.1.0.${i}`, 5);
  // El contador global sigue su curso (39 consumidos): no vuelve a empezar por haber depurado el mapa.
  assert.equal(budget.spend('global', 40), 38);
  day = '2026-10-27T00:05:00.000Z';
  assert.equal(budget.spend('global', 40), 39, 'el día nuevo sí lo reinicia, y se reinicia al día siguiente');
});

for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
