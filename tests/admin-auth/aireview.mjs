// Revisor IA: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/aireview.mjs
import assert from 'node:assert/strict';
import http from 'node:http';

// Base de datos simulada mínima (external_offers + integration_connections vacío: se inyecta el LLM).
const rows = new Map(); const fault = {}; const saved = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); let body = '';
  req.on('data', c => body += c); req.on('end', () => {
    const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (url.pathname === '/rest/v1/weekly_reports') { saved.push(JSON.parse(body || '{}')); return send(201, {}); }
    if (url.pathname !== '/rest/v1/external_offers') return send(200, []);
    const q = Object.fromEntries(url.searchParams);
    let list = [...rows.values()];
    if (req.method === 'PATCH') {
      const ids = q.id?.startsWith('in.(') ? q.id.slice(4, -1).split(',') : [q.id.slice(3)];
      const patch = JSON.parse(body);
      if (fault.failAnnotate && 'ai_review' in patch && !('editorial_status' in patch)) return send(500, {});
      if (fault.raceOnApply && 'editorial_status' in patch) for (const id of ids) rows.get(id).editorial_status = 'needs_review'; // una persona la movió entretanto
      let hit = list.filter(r => ids.includes(r.id));
      if (q.ai_review === 'is.null') hit = hit.filter(r => !r.ai_review);
      if (q.editorial_status?.startsWith('eq.')) hit = hit.filter(r => `eq.${r.editorial_status}` === q.editorial_status);
      hit.forEach(r => Object.assign(r, patch)); return send(200, hit);
    }
    if (q.ai_review === 'is.null') list = list.filter(r => !r.ai_review);
    if (q.editorial_status?.startsWith('in.(')) list = list.filter(r => q.editorial_status.slice(4, -1).split(',').includes(r.editorial_status));
    if (q.reviewed_by) list = list.filter(r => `eq.${r.reviewed_by}` === q.reviewed_by);
    if (q.id?.startsWith('in.(')) list = list.filter(r => q.id.slice(4, -1).split(',').includes(r.id));
    list.sort((a, b) => b.score - a.score);
    // Paginado como PostgREST: `limit` + `offset` (sin `offset`, una lectura por páginas nunca avanzaría).
    const offset = Number(q.offset) || 0;
    send(200, list.slice(offset, offset + (Number(q.limit) || 100)));
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; process.env.SUPABASE_PUBLISHABLE_KEY = 'a';
const ai = await import('../../apps/web/lib/aiReview.ts');
const { jevAnnotate } = await import('../../apps/web/lib/jev.ts');

// 1) Saneado: JSON malformado, valores fuera de los CHECK, texto con HTML/correos.
assert.equal(ai.sanitizeProposal('no es json').verdict, 'human');
assert.equal(ai.sanitizeProposal('{"verdict":').confidence, 0);
assert.equal(ai.sanitizeProposal('[1,2]').verdict, 'human');
assert.equal(ai.sanitizeProposal(null).verdict, 'human');
const p = ai.sanitizeProposal('```json\n{"verdict":"approve","confidence":"97.4","reasons":["<b>ok</b> a@b.com",5],"red_flags":["Pide Dinero!"],"signals":{"market":"MULTI","pay_model":"comision","remote":"yes"}}\n```');
assert.equal(p.verdict, 'approve'); assert.equal(p.confidence, 97);
assert.ok(!/[<@]/.test(p.reasons[0]) && p.reasons.length === 1);
assert.deepEqual(p.red_flags, ['pide_dinero']);
assert.deepEqual(p.signals, { market: null, pay_model: 'comision', remote: null });
assert.equal(ai.sanitizeProposal('{"verdict":"APPROVE!!","confidence":500}').verdict, 'human');
assert.equal(ai.sanitizeProposal('{"verdict":"approve","confidence":500}').confidence, 100);
assert.equal(ai.sanitizeProposal('{"verdict":"approve","confidence":-5}').confidence, 0);
console.log('PASS  saneado: JSON malformado, rangos y CHECK');

// 2) Puerta: umbrales exactos, tope, red flags, enlace, muestra de auditoría.
const open = { result: 'open', reason: 'http_200' };
const ok = { verdict: 'approve', confidence: 85, reasons: [], red_flags: [], signals: { market: null, pay_model: null, remote: null } };
let id = 0; const fresh = () => { for (;;) { const s = `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`; if (!ai.auditSample(s)) return s; } };
const g = (o = {}) => ai.gate({ proposal: ok, score: 80, offerRedFlags: [], link: open, id: fresh(), approvedSoFar: 0, maxApprovals: 25, ...o });
assert.equal(g().decision, 'approve');
assert.equal(g({ proposal: { ...ok, confidence: 84 } }).decision, 'human');
assert.equal(g({ score: 79 }).decision, 'human');
assert.equal(g({ offerRedFlags: ['mlm'] }).decision, 'human');
assert.equal(g({ proposal: { ...ok, red_flags: ['x'] } }).decision, 'human');
assert.equal(g({ proposal: { ...ok, verdict: 'human' } }).decision, 'human');
assert.equal(g({ proposal: { ...ok, verdict: 'reject' } }).decision, 'withdraw');
assert.equal(g({ proposal: { ...ok, verdict: 'reject', confidence: 60 } }).decision, 'human', 'un rechazo con poca confianza no retira solo');
assert.equal(g({ link: { result: 'closed', reason: 'http_404' } }).decision, 'withdraw');
assert.equal(g({ link: { result: 'unknown', reason: 'red' } }).decision, 'approve'); // enlace no verificable no bloquea
assert.equal(g({ approvedSoFar: 24 }).decision, 'approve');
assert.equal(g({ approvedSoFar: 25 }).why, 'tope_por_ejecucion');
const sample = Array.from({ length: 2000 }, (_, i) => `id-${i}`).filter(ai.auditSample).length;
assert.ok(sample > 120 && sample < 280, `muestra≈10%: ${sample}`);
assert.equal(ai.gate({ proposal: ok, score: 99, offerRedFlags: [], link: open, id: Array.from({ length: 50 }, (_, i) => `id-${i}`).find(ai.auditSample), approvedSoFar: 0, maxApprovals: 25 }).audit_sample, true);
console.log('PASS  puerta determinista: umbrales exactos, tope, auditoría 10 %');

// 3) SSRF y redes sociales.
for (const bad of ['http://127.0.0.1/x', 'http://10.0.0.5/', 'http://[::1]/', 'http://2130706433/', 'http://0x7f.1/', 'http://localhost/', 'http://intranet/', 'http://db.internal/', 'ftp://example.com/', 'http://user:pw@example.com/', 'https://example.com:8443/', 'https://www.linkedin.com/jobs/1', 'https://x.com/a', 'https://t.me/c', 'nope'])
  assert.equal(ai.hostAllowed(bad).ok, false, bad);
assert.equal(ai.hostAllowed('https://jobs.example.com/oferta/1').ok, true);
for (const ip of ['127.0.0.1', '10.1.1.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(ai.privateAddress(ip), true, ip);
for (const ip of ['8.8.8.8', '151.101.1.1', '2606:4700::1']) assert.equal(ai.privateAddress(ip), false, ip);
let fetched = 0;
const fx = (status, text = '', headers = {}) => async () => { fetched++; return new Response(text, { status, headers }); };
assert.equal((await ai.checkLink('http://127.0.0.1/', { fetchImpl: fx(200) })).result, 'skipped');
assert.equal((await ai.checkLink('https://evil.example.com/', { fetchImpl: fx(200), resolve: async () => ['10.0.0.9'] })).reason, 'resuelve_a_red_interna'); // DNS rebinding
assert.equal(fetched, 0, 'nunca se hace GET a destinos bloqueados');
const pub = async () => ['93.184.216.34'];
assert.equal((await ai.checkLink('https://a.example.com/1', { fetchImpl: fx(404), resolve: pub })).result, 'closed');
assert.equal((await ai.checkLink('https://a.example.com/1', { fetchImpl: fx(410), resolve: pub })).result, 'closed');
assert.equal((await ai.checkLink('https://a.example.com/1', { fetchImpl: fx(200, '<h1>Esta oferta ya no está disponible</h1>'), resolve: pub })).result, 'closed');
assert.equal((await ai.checkLink('https://a.example.com/1', { fetchImpl: fx(200, 'We are hiring a Closer'), resolve: pub })).result, 'open');
assert.equal((await ai.checkLink('https://a.example.com/1', { fetchImpl: fx(429), resolve: pub })).result, 'unknown');
assert.equal((await ai.checkLink('https://a.example.com/1', { fetchImpl: fx(302, '', { location: 'http://169.254.169.254/latest' }), resolve: pub })).reason, 'ip_literal'); // redirección a metadatos
assert.equal((await ai.checkLink('https://a.example.com/1', { fetchImpl: fx(302, '', { location: 'https://www.linkedin.com/x' }), resolve: pub })).reason, 'red_social');
console.log('PASS  SSRF: IP literal, host interno, DNS rebinding, redirecciones, redes sociales; 404/410/texto ⇒ closed');

// 4) Jev: sin clave se omite; con fallo se omite; solo anota.
assert.equal(await jevAnnotate({ title: 't', company: null, location: null, url: 'https://x.y', salary: null, description: null }, {}), null);
assert.equal(await jevAnnotate({ title: 't', company: null, location: null, url: 'https://x.y', salary: null, description: null }, { JEV_API_KEY: 'k', JEV_API_URL: 'https://jev.test' }, async () => { throw new Error('x'); }), null);
const jv = await jevAnnotate({ title: 't', company: null, location: null, url: 'https://x.y', salary: null, description: null }, { JEV_API_KEY: 'k', JEV_API_URL: 'https://jev.test' }, async () => Response.json({ verdict: 'ok', score: 250, note: 'a@b.com', evil: 'x' }));
assert.deepEqual(jv, { verdict: 'ok', score: 100, note: '[correo omitido]' });
console.log('PASS  Jev: omitido sin clave o con fallo; salida saneada');

// 5) Ejecución extremo a extremo: shadow no cambia estados; live sí, con tope, auditoría y deshacer.
const seed = () => {
  rows.clear();
  for (let i = 0; i < 6; i++) { const rid = `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`; rows.set(rid, { id: rid, title: `Closer ${i}`, company: 'Acme', location: 'Madrid', url: `https://jobs.example.com/${i}`, salary: null, description: 'ventas', score: 95 - i, red_flags: [], editorial_status: 'draft', ai_review: null, reviewed_by: null }); }
};
const llm = async prompt => { assert.ok(prompt.includes('<oferta_no_confiable>')); return prompt.includes('Closer 5') ? '{"verdict":"reject","confidence":90,"reasons":["MLM"]}' : prompt.includes('Closer 4') ? 'basura' : '{"verdict":"approve","confidence":95,"reasons":["ok"],"red_flags":[]}'; };
const pubFetch = async () => new Response('Closer en Acme', { status: 200 });
const base = { llm, fetchImpl: pubFetch, resolve: pub };
seed();
const shadow = await ai.runAiReview({ ...base, env: {} });
assert.equal(shadow.mode, 'shadow'); assert.equal(shadow.reviewed, 6); assert.equal(shadow.applied, 0);
assert.ok([...rows.values()].every(r => r.editorial_status === 'draft' && r.ai_review && r.ai_review.applied === false), 'shadow: ningún estado cambia, todo anotado');
assert.ok(shadow.would_withdraw >= 1 && shadow.human >= 1);
assert.equal((await ai.runAiReview({ ...base, env: {} })).reviewed, 0, 'no se revisa dos veces');
assert.equal((await ai.runAiReview({ ...base, env: { AI_REVIEW_ENABLED: 'false' } })).skipped?.startsWith('desactivado'), true);
seed(); const capped = await ai.runAiReview({ ...base, env: { AI_REVIEW_MAX_CALLS: '3' } });
assert.equal(capped.reviewed, 3, 'tope de llamadas al modelo');
seed(); const live = await ai.runAiReview({ ...base, env: { AI_REVIEW_MODE: 'live', AI_REVIEW_MAX_APPROVALS: '2' } });
const st = [...rows.values()].map(r => r.editorial_status);
assert.equal(live.mode, 'live'); assert.ok(st.filter(s => s === 'approved').length <= 2, 'tope de aprobaciones');
assert.equal(st.filter(s => s === 'withdrawn').length, 1);
assert.ok(![...rows.values()].some(r => r.editorial_status === 'published'), 'AUTO_PUBLISH=false deja approved');
assert.ok([...rows.values()].filter(r => r.reviewed_by === 'ai-review').every(r => r.ai_review.applied === true), 'auditoría: reviewed_by + applied');
const undone = await ai.undoAiDecisions('admin@x.dev');
assert.equal(undone, live.applied); assert.ok([...rows.values()].every(r => r.editorial_status === 'draft'), 'deshacer devuelve el estado previo');
seed(); await ai.runAiReview({ ...base, env: { AI_REVIEW_MODE: 'live', AUTO_PUBLISH: 'true' } });
assert.ok([...rows.values()].some(r => r.editorial_status === 'published'));
console.log('PASS  ejecución: shadow no cambia estados; live con tope, auditoría y deshacer; AUTO_PUBLISH');

// 6) Escrituras que no se ignoran: anotación fallida, carrera con una persona y presupuesto de tiempo.
seed(); fault.failAnnotate = true;
const fa = await ai.runAiReview({ ...base, env: { AI_REVIEW_MODE: 'live' } });
assert.equal(fa.reviewed, 0, 'si no se pudo anotar, no cuenta como revisada'); assert.equal(fa.failed_writes, 6); assert.equal(fa.applied, 0);
assert.ok([...rows.values()].every(r => r.editorial_status === 'draft' && !r.ai_review), 'y no se cambia ningún estado');
fault.failAnnotate = false;
seed(); fault.raceOnApply = true;
const race = await ai.runAiReview({ ...base, env: { AI_REVIEW_MODE: 'live' } });
assert.equal(race.applied, 0, 'si una persona movió la oferta, la IA no la pisa'); assert.ok(race.failed_writes >= 1);
assert.ok([...rows.values()].every(r => r.editorial_status !== 'approved' && r.editorial_status !== 'withdrawn'), 'ninguna aprobada/retirada por la IA');
assert.ok([...rows.values()].every(r => r.ai_review && r.ai_review.applied === false), 'queda anotada como no aplicada');
fault.raceOnApply = false;
seed();
const tight = await ai.runAiReview({ ...base, env: {}, deadline: Date.now() + 5000 });
assert.equal(tight.truncated, true); assert.equal(tight.reviewed, 0, 'con menos de ~20 s no empieza ninguna oferta');
seed();
const roomy = await ai.runAiReview({ ...base, env: {}, deadline: Date.now() + 60000 });
assert.equal(roomy.truncated, undefined); assert.equal(roomy.reviewed, 6);
console.log('PASS  escrituras: anotación fallida no cuenta, guarda de estado frente a personas, corte por presupuesto');

// 7) Informe semanal: PostgREST corta en 1.000 filas, así que se lee por páginas y el informe da el total real.
rows.clear(); saved.length = 0;
for (let i = 0; i < 1500; i++) {
  const rid = `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`;
  rows.set(rid, { id: rid, org_id: 'cloud-wdc', editorial_status: 'draft', score: 50, ai_review: { would_decide: i % 3 === 0 ? 'approve' : 'human', applied: i % 5 === 0, audit_sample: false, reviewed_at: '2026-10-25T10:00:00.000Z' } });
}
assert.equal(await ai.weeklyAiReport(new Date('2026-10-26T10:00:00Z')), true);
const weekly = saved.at(-1).payload.ai_review;
assert.equal(weekly.reviewed, 1500, 'no se corta en las 1.000 de una sola respuesta');
assert.equal(weekly.would_approve, 500); assert.equal(weekly.applied, 300);
assert.equal(weekly.truncated, false, 'sin llegar al tope no se marca parcial');
console.log('PASS  informe semanal: 1.500 ofertas leídas por páginas y parcialidad declarada');
server.close();
