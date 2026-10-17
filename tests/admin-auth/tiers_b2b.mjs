// Niveles de fuentes y leads B2B: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/tiers_b2b.mjs
import assert from 'node:assert/strict';
import http from 'node:http';

const leads = new Map(); let lastPost = null;
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const url = new URL(req.url, 'http://x'); const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (url.pathname !== '/rest/v1/b2b_leads') return send(404, {});
    if (req.method === 'POST') { // simula on_conflict + merge-duplicates: solo pisa las columnas enviadas
      assert.equal(url.searchParams.get('on_conflict'), 'org_id,advertiser,market'); assert.match(req.headers.prefer, /merge-duplicates/);
      lastPost = JSON.parse(body);
      for (const r of lastPost) { const k = `${r.org_id}|${r.advertiser}|${r.market}`; leads.set(k, { id: leads.get(k)?.id ?? crypto.randomUUID(), status: 'nuevo', notes: null, ...leads.get(k), ...r }); }
      return send(201, {});
    }
    if (req.method === 'PATCH') { const ids = url.searchParams.get('id').slice(4, -1).split(','); const hit = [...leads.values()].filter(l => ids.includes(l.id)); hit.forEach(l => Object.assign(l, JSON.parse(body))); return send(200, hit); }
    send(200, [...leads.values()]);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; process.env.SUPABASE_PUBLISHABLE_KEY = 'a';
const t = await import('../../apps/web/lib/sourceTiers.ts');
const b = await import('../../apps/web/lib/b2bLeads.ts');

// Niveles
assert.deepEqual(['infojobs', 'indeed', 'apify-jobspy', 'apify', 'greenhouse-cabify', 'google'].map(t.tierOf), ['official', 'scrape', 'paid', 'paid', 'other', 'scrape']);
const perDay = (n, d = 7) => [...Array(14 - d).fill(0), ...Array(d).fill(n)];
const m = { perSource: [{ source: 'infojobs', perDay: perDay(2) }, { source: 'indeed', perDay: perDay(1) }, { source: 'apify-jobspy', perDay: perDay(50) }] };
assert.equal(t.freeGoodPerDay(m), 3, 'el nivel de pago no cuenta');
assert.equal(t.skipPaidTier(m, {}).skip, false, 'sin variable: comportamiento de siempre');
assert.equal(t.skipPaidTier(m, { APIFY_SKIP_IF_GOOD_PER_DAY: '0' }).skip, false);
assert.equal(t.skipPaidTier(m, { APIFY_SKIP_IF_GOOD_PER_DAY: 'x' }).skip, false);
assert.equal(t.skipPaidTier(m, { APIFY_SKIP_IF_GOOD_PER_DAY: '3' }).skip, true, 'umbral exacto: 3 ≥ 3');
assert.equal(t.skipPaidTier(m, { APIFY_SKIP_IF_GOOD_PER_DAY: '3.1' }).skip, false);
assert.equal(t.skipPaidTier(null, { APIFY_SKIP_IF_GOOD_PER_DAY: '1' }).skip, false, 'sin métricas no se bloquea');
console.log('PASS  niveles: clasificación, gratuitas vs pago y política opt-in con umbral exacto');

// Leads B2B
assert.equal(b.sanitizeLead(null), null); assert.equal(b.sanitizeLead({ advertiser: '  ' }), null);
const l = b.sanitizeLead({ advertiser: ' Acme <b>Clinics</b> ', market: 'MARS', ad_library_url: 'javascript:alert(1)', landing_url: 'https://acme.test/x', vertical: 'a@b.com', weeks_active: '12.34', cta: 5 });
assert.deepEqual(l, { advertiser: 'Acme Clinics', market: 'MULTI', ad_library_url: null, landing_url: 'https://acme.test/x', vertical: '[correo omitido]', cta: '5', weeks_active: 12.3 });
assert.equal(b.sanitizeLead({ advertiser: 'X', market: 'ES', weeks_active: -3 }).weeks_active, null);
assert.equal(b.sanitizeLead({ advertiser: 'X', weeks_active: 9999 }).weeks_active, null);
const r1 = await b.importLeads([{ advertiser: 'Acme', market: 'ES' }, { advertiser: 'acme', market: 'ES' }, { advertiser: 'Beta' }, 'basura', {}]);
assert.deepEqual(r1, { received: 5, accepted: 2, rejected: 3 });
assert.ok(lastPost.every(x => x.org_id === 'cloud-wdc' && !('status' in x) && !('notes' in x)), 'org fija y nunca se envía status/notes');
const all = await b.listLeads(); assert.equal(all.length, 2);
const acme = all.find(x => x.advertiser.toLowerCase() === 'acme'); // en el lote gana la última variante de mayúsculas
assert.equal(await b.setLeadStatus([acme.id], 'contactado', 'llamar el lunes'), 1);
await b.importLeads([{ advertiser: acme.advertiser, market: 'ES', weeks_active: 20 }]);
const after = (await b.listLeads()).find(x => x.advertiser.toLowerCase() === 'acme');
assert.equal(after.status, 'contactado'); assert.equal(after.notes, 'llamar el lunes'); assert.equal(after.weeks_active, 20, 'reimportar actualiza datos pero conserva el trabajo humano');
assert.equal(await b.setLeadStatus([acme.id], 'inventado'), null);
assert.equal(await b.setLeadStatus(['no-uuid'], 'nuevo'), null);
assert.equal(await b.setLeadStatus(Array(101).fill(acme.id), 'nuevo'), null);
console.log('PASS  leads B2B: saneado, org fija, alta idempotente que conserva estado/notas, estados validados');
server.close();
