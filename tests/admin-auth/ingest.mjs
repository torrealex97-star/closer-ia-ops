// Robustez de ingesta: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/ingest.mjs
import assert from 'node:assert/strict';
import http from 'node:http';

let mode = 'ok', calls = 0; const saved = [], runs = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const url = new URL(req.url, 'http://x'); const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (url.pathname === '/rest/v1/rpc/external_upsert') {
      calls++; const rows = JSON.parse(body).p_rows;
      if (mode === 'down') return send(503, {});
      if (mode === 'flaky' && calls <= 2) return send(502, {});
      if (mode === 'poison' && rows.some(r => r.title === 'BAD')) return send(400, { message: 'check violation' });
      saved.push(...rows); return send(200, rows.length);
    }
    if (url.pathname === '/rest/v1/external_ingest_runs' && req.method === 'POST') { runs.push(JSON.parse(body)); return send(201, {}); }
    send(200, []);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; process.env.SUPABASE_PUBLISHABLE_KEY = 'a';
const ex = await import('../../apps/web/lib/external.ts');
const cand = (i, extra = {}) => ({ external_id: `e${i}`, title: `Closer ${i}`, company: 'Acme', location: 'Madrid', url: `https://jobs.example.com/${i}`, ...extra });
const reset = (m) => { mode = m; calls = 0; saved.length = 0; runs.length = 0; };

// 1) Motivos de descarte y URL canónica
assert.deepEqual(ex.classify(null), { reason: 'no_objeto' });
assert.deepEqual(ex.classify({ title: 't', url: 'https://a.b' }), { reason: 'sin_id' });
assert.deepEqual(ex.classify({ external_id: '1', url: 'https://a.b' }), { reason: 'sin_titulo' });
assert.deepEqual(ex.classify({ external_id: '1', title: 't' }), { reason: 'sin_url' });
assert.deepEqual(ex.classify({ external_id: '1', title: 't', url: 'javascript:alert(1)' }), { reason: 'url_no_http' });
assert.equal(ex.normalizeUrl('https://x.com/job/1?utm_source=a&id=7&fbclid=z#apply'), 'https://x.com/job/1?id=7');
assert.equal(ex.normalizeUrl('https://x.com/job/1?b=2&a=1'), 'https://x.com/job/1?a=1&b=2');
assert.equal(ex.sanitize(cand(1, { url: 'https://x.com/j?utm_campaign=q' })).url, 'https://x.com/j');
console.log('PASS  ingesta: motivos de descarte y URL canónica sin seguimiento');

// 2) Descartes contados en la nota; mismo anuncio por URL en el lote se une
reset('ok');
const r = await ex.ingest('t-src', 'test', [cand(1), cand(2), { title: 'sin id', url: 'https://a.b' }, 'basura', cand(3, { external_id: 'e3b', url: 'https://jobs.example.com/1?utm_source=x' })]);
assert.deepEqual([r.received, r.accepted, r.rejected], [5, 2, 3]);
assert.match(runs[0].note, /descartadas .*sin_id:1/); assert.match(runs[0].note, /no_objeto:1/);
console.log('PASS  ingesta: descartes registrados con motivo; duplicado por URL canónica unido');

// 3) Reintentos ante 5xx/red y recuperación
reset('flaky'); const sleeps = [];
const out = await ex.saveCandidates('t-src', [{ external_id: 'a' }], async ms => { sleeps.push(ms); });
assert.deepEqual(out, { accepted: 1, failed: 0 }); assert.deepEqual(sleeps, [300, 600]); assert.equal(calls, 3);
console.log('PASS  ingesta: 2 reintentos con espera exponencial ante 5xx');

// 4) Una fila venenosa no tumba el lote: se aísla
reset('poison');
const many = Array.from({ length: 250 }, (_, i) => ({ external_id: `p${i}`, title: i === 130 ? 'BAD' : `ok ${i}` }));
const iso = await ex.saveCandidates('t-src', many, async () => {});
assert.deepEqual(iso, { accepted: 249, failed: 1 }); assert.equal(saved.length, 249); assert.ok(!saved.some(x => x.title === 'BAD'));
reset('poison');
const ing = await ex.ingest('t-src', 'test', [cand(1), cand(2, { title: 'BAD' }), cand(3)]);
assert.equal(ing.accepted, 2); assert.match(runs[0].note, /1 fila\(s\) no se pudieron guardar/);
console.log('PASS  ingesta: lotes de 100 y aislamiento de la fila mala; lo guardado no se oculta');

// 5) Caída total: error (no éxito falso), sin reintentos de datos (400) infinitos
reset('down');
await assert.rejects(ex.ingest('t-src', 'test', [cand(1)]), /No se pudo guardar/);
reset('poison'); await ex.saveCandidates('t-src', [{ external_id: 'x', title: 'BAD' }], async () => assert.fail('un 400 no se reintenta')).catch(() => {});
console.log('PASS  ingesta: caída total lanza error; un 400 no se reintenta');
server.close();
