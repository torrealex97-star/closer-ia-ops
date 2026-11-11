// Limitador de intentos de login: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/loginlimit.mjs
import assert from 'node:assert/strict';
import { createLoginLimiter, PER_ACCOUNT, PER_IP, WINDOW_MS, MAX_KEYS } from '../../apps/web/lib/loginLimit.ts';

let t = 1_000_000; const now = () => t;
const lim = createLoginLimiter({ now });
assert.equal(lim.blockedFor('1.1.1.1', 'a@x.dev'), null);
for (let i = 0; i < PER_ACCOUNT; i++) { assert.equal(lim.blockedFor('1.1.1.1', 'a@x.dev'), null, `intento ${i + 1} permitido`); lim.fail('1.1.1.1', 'a@x.dev'); }
const wait = lim.blockedFor('1.1.1.1', 'a@x.dev');
assert.ok(wait !== null && wait > 0 && wait <= WINDOW_MS / 1000, 'tras los fallos de la cuenta se bloquea con Retry-After');
// Otra cuenta desde el mismo origen y la misma cuenta desde otro origen NO quedan bloqueadas (sin denegación de servicio a la dueña).
assert.equal(lim.blockedFor('1.1.1.1', 'b@x.dev'), null);
assert.equal(lim.blockedFor('2.2.2.2', 'a@x.dev'), null);
// La ventana caduca.
t += WINDOW_MS + 1; assert.equal(lim.blockedFor('1.1.1.1', 'a@x.dev'), null);
// Barrido de muchas cuentas desde una IP: se corta por IP.
for (let i = 0; i < PER_IP; i++) lim.fail('9.9.9.9', `u${i}@x.dev`);
assert.ok(lim.blockedFor('9.9.9.9', 'nueva@x.dev') !== null, 'el barrido desde una IP se frena');
// Un acierto limpia la cuenta, no la IP.
const l2 = createLoginLimiter({ now }); for (let i = 0; i < PER_ACCOUNT - 1; i++) l2.fail('3.3.3.3', 'c@x.dev'); l2.succeed('3.3.3.3', 'c@x.dev');
for (let i = 0; i < PER_ACCOUNT - 1; i++) l2.fail('3.3.3.3', 'c@x.dev'); assert.equal(l2.blockedFor('3.3.3.3', 'c@x.dev'), null, 'el acierto reinició el contador de la cuenta');
// Tope duro de memoria con claves inventadas.
const l3 = createLoginLimiter({ now }); for (let i = 0; i < MAX_KEYS * 2; i++) l3.fail(`10.0.${i}`, `x${i}@x.dev`);
assert.ok(l3.size <= MAX_KEYS, `el mapa no crece sin tope (${l3.size})`);
console.log('PASS  limitador de login: por cuenta y por IP, caduca, sin bloquear a la dueña desde otro origen, memoria acotada');
