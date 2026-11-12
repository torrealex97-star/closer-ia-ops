// Guardián SSRF para el port a Cloudflare Workers: corre sin `node:http`, `node:https`, `node:dns/promises`
// ni `node:net`. Lo que fija esta prueba:
//   · una URL se valida ENTERA sin red (esquema, credenciales, puerto, IP literal, host interno, red social);
//   · la allowlist es la política: un host fuera de ella no se pide, y se declara con su razón;
//   · las redirecciones NO se siguen: el siguiente salto se vuelve a validar (una IP literal muere ahí);
//   · el tope de bytes se respeta y un fallo de red no se convierte en éxito;
//   · el archivo del guardián no importa nada de `node:` (es lo que le permite correr en workerd).
// Ejecutar: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/urlguard.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { hostAllowed, privateAddress, guardedGet, siteOf, allowedSites, ALLOWED_SITES } = await import('../../apps/web/lib/urlGuard.ts');
const { checkLink } = await import('../../apps/web/lib/aiReview.ts');
const { isIP } = await import('../../apps/web/lib/ipLiteral.ts');

const results = []; const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, String(e.message).split('\n')[0]]); } };

await step('esquema, credenciales, puerto: fuera antes de mirar el host', async () => {
  for (const u of ['ftp://jobs.example.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@jobtoday.com/x', 'https://jobtoday.com:8443/x']) {
    assert.equal(hostAllowed(u).ok, false, u);
  }
  assert.equal(hostAllowed('https://user:pw@jobtoday.com/x').reason, 'credenciales_en_url');
  assert.equal(hostAllowed('https://jobtoday.com:8443/x').reason, 'puerto');
  assert.equal(hostAllowed('https://jobtoday.com:443/x').ok, true, '443 explícito es válido');
});

await step('IP literales: todas las formas que se colaron históricamente', async () => {
  const literals = [
    'http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://169.254.169.254/latest', 'http://192.168.1.1/x',
    'http://2130706433/x', 'http://0x7f000001/x', 'http://0177.0.0.1/x', 'http://[::1]/x',
    'http://[::ffff:127.0.0.1]/x', 'http://[fd00::1]/x', 'http://0.0.0.0/x', 'http://100.64.0.1/x',
  ];
  for (const u of literals) {
    const check = hostAllowed(u);
    assert.equal(check.ok, false, u);
    assert.equal(check.reason, 'ip_literal', u);
  }
});

await step('hosts internos y de una sola etiqueta', async () => {
  for (const u of ['http://localhost/x', 'http://app.local/x', 'http://db.internal/x', 'http://intranet/x', 'http://router.lan/x', 'http://printer.home/x']) {
    const check = hostAllowed(u);
    assert.equal(check.ok, false, u);
    assert.equal(check.reason, 'host_interno', u);
  }
});

await step('redes sociales: no se verifican enlaces de LinkedIn ni de Telegram', async () => {
  for (const u of ['https://www.linkedin.com/jobs/view/1', 'https://t.me/oferta', 'https://x.com/i/status/1', 'https://www.instagram.com/p/abc']) {
    assert.equal(hostAllowed(u).reason, 'red_social', u);
  }
});

await step('allowlist: los portales medidos pasan; lo demás no se pide (falla cerrada)', async () => {
  assert.ok(ALLOWED_SITES.length >= 100, 'la allowlist tiene los dominios medidos');
  for (const u of ['https://www.infojobs.net/oferta/1', 'https://jobtoday.com/es/oferta/2', 'https://jobs.lever.co/acme/123', 'https://job-boards.greenhouse.io/acme/jobs/1', 'https://mango.wd3.myworkdayjobs.com/x', 'https://scalpers.factorial.es/oferta']) {
    assert.equal(hostAllowed(u).ok, true, u);
  }
  const fuera = hostAllowed('https://ofertas-de-verdad.example/x');
  assert.equal(fuera.ok, false);
  assert.equal(fuera.reason, 'host_no_autorizado');
  assert.equal(hostAllowed('https://evil.infojobs.net.attacker.example/x').reason, 'host_no_autorizado', 'un sufijo mal escrito no cuela');
});

await step('allowlist ampliable por entorno, sin abrirla entera', async () => {
  assert.equal(allowedSites('nuevoportal.es, .otro.example').includes('nuevoportal.es'), true);
  assert.equal(allowedSites('nuevoportal.es, .otro.example').includes('otro.example'), true, 'se limpia el punto inicial');
  assert.equal(hostAllowed('https://www.nuevoportal.es/x', { allowlist: allowedSites('nuevoportal.es') }).ok, true);
  assert.equal(hostAllowed('https://www.nuevoportal.es/x').reason, 'host_no_autorizado', 'sin la extensión, no pasa');
  assert.equal(hostAllowed('https://otro.example/x', { allowlist: null }).ok, true, 'allowlist: null es solo para llamadas internas/pruebas');
});

await step('siteOf: subdominio y sufijos de dos niveles', async () => {
  assert.equal(siteOf('jobs.lever.co'), 'lever.co');
  assert.equal(siteOf('WWW.InfoJobs.NET'), 'infojobs.net');
  assert.equal(siteOf('x.empresa.com.br'), 'empresa.com.br');
  assert.equal(siteOf('a.b.c.teamtaylor.com'), 'teamtaylor.com');
});

await step('privateAddress: rangos privados, mapeadas en hexadecimal y públicas', async () => {
  for (const ip of ['127.0.0.1', '10.1.1.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe']) {
    assert.equal(privateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '151.101.1.1', '172.32.0.1', '2606:4700::1', '::ffff:8.8.8.8']) assert.equal(privateAddress(ip), false, ip);
});

await step('isIP propio (sin node:net) reconoce las mismas formas', async () => {
  assert.equal(isIP('1.2.3.4'), 4);
  assert.equal(isIP('::1'), 6);
  assert.equal(isIP('::ffff:127.0.0.1'), 6);
  assert.equal(isIP('fe80::1'), 6);
  assert.equal(isIP('jobtoday.com'), 0);
  assert.equal(isIP('999.1.1.1'), 0);
});

// ---- guardedGet con fetch inyectado: ni red real ni sorpresas ----
const fakeFetch = (handler) => { const calls = []; const fn = async (url, init) => { calls.push(String(url)); return handler(String(url), init); }; fn.calls = calls; return fn; };
const res = (status, body = '', headers = {}) => new Response(status === 204 || status === 304 ? null : body, { status, headers });

await step('guardedGet: no sigue redirecciones y devuelve location', async () => {
  const f = fakeFetch(() => res(302, '', { location: 'http://127.0.0.1/x' }));
  const got = await guardedGet('https://jobtoday.com/es/oferta/1', { timeoutMs: 500, fetchImpl: f });
  assert.equal(got.ok, true); assert.equal(got.status, 302); assert.equal(got.location, 'http://127.0.0.1/x');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0], 'https://jobtoday.com/es/oferta/1', 'la petición fue al host validado, no al destino del 302');
});

await step('guardedGet: un host fuera de la allowlist no genera NINGUNA petición', async () => {
  const f = fakeFetch(() => res(200, 'ok'));
  const got = await guardedGet('https://ofertas-de-verdad.example/x', { timeoutMs: 500, fetchImpl: f });
  assert.equal(got.ok, false); assert.equal(got.reason, 'host_no_autorizado'); assert.equal(f.calls.length, 0);
});

await step('guardedGet: tope de bytes y estado 4xx tal cual', async () => {
  const big = 'x'.repeat(5000);
  const f = fakeFetch(() => res(200, big));
  const got = await guardedGet('https://jobtoday.com/es/oferta/1', { timeoutMs: 500, maxBytes: 1000, fetchImpl: f });
  assert.equal(got.ok, true); assert.equal(got.text.length, 1000);
  const f404 = fakeFetch(() => res(404, 'no'));
  const r404 = await guardedGet('https://jobtoday.com/es/oferta/1', { timeoutMs: 500, fetchImpl: f404 });
  assert.equal(r404.ok, true); assert.equal(r404.status, 404);
});

await step('guardedGet: un fallo de red es «red», no un éxito vacío', async () => {
  const f = fakeFetch(() => { throw new Error('boom'); });
  const got = await guardedGet('https://jobtoday.com/es/oferta/1', { timeoutMs: 500, fetchImpl: f });
  assert.equal(got.ok, false); assert.equal(got.reason, 'red');
});

// ---- checkLink (revisor IA) con la misma guarda ----
await step('checkLink: abierta, cerrada y 404', async () => {
  const open = fakeFetch(() => res(200, '<html>Oferta de closer en Madrid</html>'));
  assert.equal((await checkLink('https://jobtoday.com/es/oferta/1', { fetchImpl: open })).result, 'open');
  const closed = fakeFetch(() => res(200, 'Esta oferta ha caducado'));
  assert.equal((await checkLink('https://jobtoday.com/es/oferta/1', { fetchImpl: closed })).result, 'closed');
  const gone = fakeFetch(() => res(410, ''));
  assert.equal((await checkLink('https://jobtoday.com/es/oferta/1', { fetchImpl: gone })).result, 'closed');
});

await step('checkLink: una redirección a IP literal o a host no listado se corta, no se sigue', async () => {
  const toIp = fakeFetch(() => res(301, '', { location: 'http://127.0.0.1/admin' }));
  const r1 = await checkLink('https://jobtoday.com/es/oferta/1', { fetchImpl: toIp });
  assert.equal(r1.result, 'skipped'); assert.equal(r1.reason, 'ip_literal');
  assert.equal(toIp.calls.length, 1, 'el salto interno no se pidió');

  const toUnknown = fakeFetch(() => res(302, '', { location: 'https://fuera-de-la-lista.example/x' }));
  const r2 = await checkLink('https://jobtoday.com/es/oferta/1', { fetchImpl: toUnknown });
  assert.equal(r2.result, 'skipped'); assert.equal(r2.reason, 'host_no_autorizado');
  assert.equal(toUnknown.calls.length, 1);
});

await step('checkLink: redirección relativa dentro del mismo host permitido sí se sigue', async () => {
  let n = 0;
  const f = fakeFetch(() => (++n === 1 ? res(302, '', { location: '/es/oferta/2' }) : res(200, 'Oferta vigente de closer')));
  assert.equal((await checkLink('https://jobtoday.com/es/oferta/1', { fetchImpl: f })).result, 'open');
  assert.equal(f.calls.length, 2);
});

await step('el guardián no importa nada de node: (corre en workerd)', async () => {
  for (const file of ['apps/web/lib/urlGuard.ts', 'apps/web/lib/ipLiteral.ts']) {
    const src = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    const imports = src.match(/from\s+'node:[^']+'/g) ?? [];
    assert.deepEqual(imports, [], `${file} sigue importando ${imports.join(', ')}`);
    assert.equal(/require\(['"]node:/.test(src), false, `${file} usa require('node:…')`);
  }
});

for (const [s, n, m] of results) console.log(`${s}  ${n}${m ? '\n      ' + m : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
