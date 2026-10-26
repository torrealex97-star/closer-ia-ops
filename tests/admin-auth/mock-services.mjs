// Servicios simulados para probar el acceso al panel sin tocar el Supabase real:
// GoTrue (token/user/recover/logout/admin users), PostgREST (admin_users) y el motor cloud (lecturas).
import http from 'node:http';

export function startMocks({ authPort, enginePort }) {
  const state = {
    users: new Map([['owner@test.dev', { id: 'u1', password: 'Correcta-12345' }]]),
    admins: [{ email: 'owner@test.dev', role: 'owner', invited_by: 'bootstrap', created_at: '2026-10-16T00:00:00Z' }],
    connections: new Map(), external: new Map(), sourceSettings: new Map(), apifyActors: [], apifyRuns: [], apifyCalls: [], apifyItems: [], apifyStatus: 'SUCCEEDED', ingestRuns: [], tokens: new Map(), recoverCalls: [], recoverTokens: new Map(),
    engineDown: false, // simula la pausa de cuota del motor (Sites devuelve 503)
  };
  const send = (res, code, body, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...extra }); res.end(JSON.stringify(body)); };
  const read = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
  const issue = email => {
    const at = 'at-' + Math.random().toString(36).slice(2), rt = 'rt-' + Math.random().toString(36).slice(2);
    state.tokens.set(at, email); state.tokens.set(rt, email);
    return { access_token: at, refresh_token: rt, expires_in: 3600, user: { id: state.users.get(email).id, email } };
  };
  state.issue = issue;

  const auth = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await read(req) : {};
    const bearer = (req.headers.authorization || '').replace('Bearer ', '');
    if (url.pathname === '/auth/v1/health') return send(res, 200, { ok: true });
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const u = state.users.get(body.email);
      return u && u.password === body.password ? send(res, 200, issue(body.email)) : send(res, 400, { msg: 'Invalid login credentials' });
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const email = state.tokens.get(body.refresh_token);
      return email && state.users.has(email) ? send(res, 200, issue(email)) : send(res, 400, { msg: 'bad refresh' });
    }
    if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
      const email = state.tokens.get(bearer);
      return email && state.users.has(email) ? send(res, 200, { id: state.users.get(email).id, email }) : send(res, 401, { msg: 'invalid JWT' });
    }
    if (url.pathname === '/auth/v1/user' && req.method === 'PUT') {
      const email = state.tokens.get(bearer);
      if (!email) return send(res, 401, { msg: 'invalid JWT' });
      if (body.password.length < 6) return send(res, 422, { msg: 'Password should be at least 6 characters' });
      state.users.get(email).password = body.password; return send(res, 200, { email });
    }
    if (url.pathname === '/auth/v1/recover') {
      state.recoverCalls.push({ email: body.email, redirect_to: url.searchParams.get('redirect_to') });
      if (state.users.has(body.email)) { const t = 'rec-' + Math.random().toString(36).slice(2); state.tokens.set(t, body.email); state.recoverTokens.set(body.email, t); }
      return send(res, 200, {});
    }
    if (url.pathname === '/auth/v1/logout') { state.tokens.delete(bearer); return send(res, 204, {}); }
    if (url.pathname === '/auth/v1/admin/users' && req.method === 'POST') {
      if (!state.admins.some(a => a.email === body.email) && !(state.students ?? []).some(x => x.email === body.email && x.status !== 'paused')) return send(res, 500, { msg: 'signup_disabled' }); // espejo del trigger de BD
      if (state.users.has(body.email)) return send(res, 422, { msg: 'exists' });
      state.users.set(body.email, { id: crypto.randomUUID(), password: null }); return send(res, 200, { id: 'new', email: body.email });
    }
    if (url.pathname === '/auth/v1/admin/users' && req.method === 'GET') {
      return send(res, 200, { users: [...state.users].map(([email, u]) => ({ id: u.id, email })) });
    }
    const del = url.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
    if (del && req.method === 'DELETE') { for (const [email, u] of state.users) if (u.id === del[1]) state.users.delete(email); return send(res, 200, {}); }
    if (url.pathname === '/rest/v1/admin_users') {
      const eq = url.searchParams.get('email');
      if (req.method === 'GET') {
        const rows = eq ? state.admins.filter(a => `eq.${a.email}` === eq) : state.admins;
        return send(res, 200, rows.map(a => ({ ...a })));
      }
      if (req.method === 'POST') {
        if (state.admins.some(a => a.email === body.email)) return send(res, 409, {});
        state.admins.push({ ...body, created_at: new Date().toISOString() }); return send(res, 201, {});
      }
      if (req.method === 'DELETE') { state.admins = state.admins.filter(a => `eq.${a.email}` !== eq); return send(res, 204, {}); }
    }
    if (url.pathname === '/rest/v1/integration_connections') {
      const eq = (url.searchParams.get('provider') || '').replace('eq.', '');
      if (req.method === 'GET') {
        const rows = [...state.connections.values()].filter(r => !eq || r.provider === eq);
        return send(res, 200, rows);
      }
      if (req.method === 'POST') { state.connections.set(body.provider, { ...body }); return send(res, 201, {}); }
      if (req.method === 'PATCH') { Object.assign(state.connections.get(eq) ?? {}, body); return send(res, 204, {}); }
      if (req.method === 'DELETE') { state.connections.delete(eq); return send(res, 204, {}); }
    }
    if (url.pathname === '/rest/v1/rpc/external_upsert' && req.method === 'POST') {
      let n = 0;
      for (const r of body.p_rows) {
        const key = `${body.p_source}|${r.external_id}`; const old = state.external.get(key);
        const dup = !old && r.fingerprint ? [...state.external.values()].find(o => o.fingerprint === r.fingerprint && o.source !== body.p_source) : null;
        if (dup) { dup.also_seen = [...new Set([...(dup.also_seen ?? []), body.p_source])]; dup.last_seen_at = new Date().toISOString(); n++; continue; }
        state.external.set(key, old ? { ...old, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined)), last_seen_at: new Date().toISOString() } : { id: crypto.randomUUID(), source: body.p_source, editorial_status: 'draft', verified_result: null, verified_at: null, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), expires_at: new Date(Date.now() + 10 * 864e5).toISOString(), raw: {}, also_seen: [], score: 0, ...r });
        n++;
      }
      return send(res, 200, n);
    }
    if (url.pathname === '/rest/v1/source_settings') {
      if (req.method === 'POST') { state.sourceSettings.set(body.source, body); return send(res, 201, {}); }
      return send(res, 200, [...state.sourceSettings.values()].filter(r => r.enabled === false).map(r => ({ source: r.source })));
    }
    if (url.pathname === '/rest/v1/external_ingest_runs') {
      if (req.method === 'POST') { state.ingestRuns.unshift({ ...body, created_at: new Date().toISOString() }); return send(res, 201, {}); }
      return send(res, 200, state.ingestRuns);
    }
    if (url.pathname === '/rest/v1/students') {
      state.students ??= []; const q = Object.fromEntries(url.searchParams); const eqv = k => q[k]?.startsWith('eq.') ? decodeURIComponent(q[k].slice(3)) : null;
      let rows = state.students.filter(r => (!eqv('email') || r.email === eqv('email')) && (!eqv('id') || r.id === eqv('id')) && (q.status !== 'neq.paused' || r.status !== 'paused'));
      if (req.method === 'POST') { if (state.students.some(r => r.email === body.email)) return send(res, 409, {}); state.students.unshift({ id: crypto.randomUUID(), user_id: null, status: 'invited', created_at: new Date().toISOString(), ...body }); return send(res, 201, {}); }
      if (req.method === 'PATCH') { rows.forEach(r => Object.assign(r, body)); return send(res, 200, rows); }
      if (req.method === 'DELETE') { state.students = state.students.filter(r => !rows.includes(r)); return send(res, 204, {}); }
      return send(res, 200, rows);
    }
    if (url.pathname === '/rest/v1/student_activity') {
      state.activity ??= []; const q = Object.fromEntries(url.searchParams);
      if (req.method === 'POST') { state.activity.unshift({ id: crypto.randomUUID(), org_id: 'cloud-wdc', created_at: new Date().toISOString(), ref: null, score: null, detail: {}, ...body }); return send(res, 201, []); }
      const eqv = k => q[k]?.startsWith('eq.') ? decodeURIComponent(q[k].slice(3)) : null;
      const gte = q.created_at?.startsWith('gte.') ? decodeURIComponent(q.created_at.slice(4)) : null;
      let rows = state.activity.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (eqv('org_id')) rows = rows.filter(r => r.org_id === eqv('org_id'));
      if (eqv('student_id')) rows = rows.filter(r => r.student_id === eqv('student_id'));
      if (gte) rows = rows.filter(r => r.created_at >= gte);
      if (Number(q.limit)) rows = rows.slice(0, Number(q.limit));
      return send(res, 200, rows);
    }
    if (url.pathname === '/rest/v1/student_application_profiles') {
      state.appProfiles ??= new Map(); const q = Object.fromEntries(url.searchParams); const uid = q.user_id?.slice(3);
      if (req.method === 'POST') { const row = { ...state.appProfiles.get(body.user_id), ...body }; state.appProfiles.set(body.user_id, row); return send(res, 201, [row]); }
      if (req.method === 'DELETE') { state.appProfiles.delete(uid); return send(res, 204, {}); }
      return send(res, 200, state.appProfiles.has(uid) ? [state.appProfiles.get(uid)] : []);
    }
    if (url.pathname === '/rest/v1/student_applications') {
      state.applications ??= []; const q = Object.fromEntries(url.searchParams); const eqv = k => q[k]?.startsWith('eq.') ? q[k].slice(3) : null;
      const mine = () => state.applications.filter(a => (!eqv('user_id') || a.user_id === eqv('user_id')) && (!eqv('id') || a.id === eqv('id')) && (!eqv('status') || a.status === eqv('status')));
      if (req.method === 'POST') {
        if (state.applications.some(a => a.user_id === body.user_id && a.offer_ref === body.offer_ref)) return send(res, 201, []);
        const row = { id: crypto.randomUUID(), status: 'draft', notes: null, applied_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body }; state.applications.push(row); return send(res, 201, [row]);
      }
      if (req.method === 'PATCH') { const hit = mine(); hit.forEach(a => Object.assign(a, body)); return send(res, 200, hit); }
      if (req.method === 'DELETE') { const hit = mine(); state.applications = state.applications.filter(a => !hit.includes(a)); return send(res, 200, hit); }
      return send(res, 200, mine().sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    }
    if (url.pathname === '/rest/v1/student_profiles') {
      state.profiles ??= new Map(); const q = Object.fromEntries(url.searchParams); const uid = q.user_id?.slice(3);
      if (req.method === 'POST') { const row = { ...state.profiles.get(body.user_id), ...body }; state.profiles.set(body.user_id, row); return send(res, 201, [row]); }
      if (req.method === 'DELETE') { state.profiles.delete(uid); return send(res, 204, {}); }
      return send(res, 200, state.profiles.has(uid) ? [state.profiles.get(uid)] : []);
    }
    if (url.pathname === '/rest/v1/b2b_leads') {
      state.leads ??= new Map();
      if (req.method === 'POST') { for (const r of body) { const k = `${r.advertiser}|${r.market}`; state.leads.set(k, { id: state.leads.get(k)?.id ?? crypto.randomUUID(), status: 'nuevo', notes: null, first_seen_at: new Date().toISOString(), ...state.leads.get(k), ...r }); } return send(res, 201, {}); }
      if (req.method === 'PATCH') { const ids = url.searchParams.get('id').slice(4, -1).split(','); const hit = [...state.leads.values()].filter(l => ids.includes(l.id)); hit.forEach(l => Object.assign(l, body)); return send(res, 200, hit); }
      return send(res, 200, [...state.leads.values()]);
    }
    if (url.pathname === '/rest/v1/external_offers') {
      const q = Object.fromEntries(url.searchParams); const ids = q.id?.startsWith('in.(') ? q.id.slice(4, -1).split(',') : q.id?.startsWith('eq.') ? [q.id.slice(3)] : null;
      let rows = [...state.external.values()];
      if (ids) rows = rows.filter(r => ids.includes(r.id));
      if (q.editorial_status?.startsWith('in.(')) rows = rows.filter(r => q.editorial_status.slice(4, -1).split(',').includes(r.editorial_status));
      else if (q.editorial_status) rows = rows.filter(r => `eq.${r.editorial_status}` === q.editorial_status);
      if (q.source) rows = rows.filter(r => `eq.${r.source}` === q.source);
      if (q.role === 'is.null') rows = rows.filter(r => !r.role); else if (q.role?.startsWith('eq.')) rows = rows.filter(r => r.role === q.role.slice(3));
      if (q.spain === 'is.true') rows = rows.filter(r => r.spain === true);
      if (q.score?.startsWith('gte.')) rows = rows.filter(r => (r.score ?? 0) >= Number(q.score.slice(4)));
      if (q.reviewed_by?.startsWith('eq.')) rows = rows.filter(r => r.reviewed_by === q.reviewed_by.slice(3));
      if (q.reviewed_at?.startsWith('gte.')) rows = rows.filter(r => r.reviewed_at && r.reviewed_at >= decodeURIComponent(q.reviewed_at.slice(4)));
      if (q.market?.startsWith('eq.')) rows = rows.filter(r => r.market === q.market.slice(3));
      if (q.expires_at?.startsWith('gt.')) rows = rows.filter(r => r.expires_at > decodeURIComponent(q.expires_at.slice(3)));
      if (q.or?.includes('verified_at.is.null')) { const lt = q.or.match(/verified_at\.lt\.([^,)]+)/)?.[1]; rows = rows.filter(r => !r.verified_at || (lt && r.verified_at < lt)); }
      else if (q.or?.includes('ilike')) { const term = decodeURIComponent(q.or.match(/title\.ilike\.\*([^*]*)\*/)?.[1] ?? '').toLowerCase(); rows = rows.filter(r => `${r.title} ${r.company ?? ''}`.toLowerCase().includes(term)); }
      if (req.method === 'PATCH') { for (const r of rows) Object.assign(r, body); return send(res, 200, rows); }
      if (q.order?.startsWith('score.desc')) rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(b.posted_at ?? '').localeCompare(String(a.posted_at ?? '')));
      else rows.sort((a, b) => String(b.posted_at ?? '').localeCompare(String(a.posted_at ?? '')));
      const offset = Number(q.offset) || 0, limit = Number(q.limit) || 200, slice = rows.slice(offset, offset + limit);
      return send(res, 200, slice, /count=exact/.test(req.headers.prefer ?? '') ? { 'content-range': `${slice.length ? offset : '*'}-${offset + slice.length - 1}/${rows.length}` } : {});
    }
    // APIs oficiales simuladas: InfoJobs (Basic), Adzuna (app_id/app_key) y Jooble (clave en la ruta).
    if (url.pathname === '/api/9/offer') {
      if (req.headers.authorization !== 'Basic ' + Buffer.from('cid:good-key-1234').toString('base64')) return send(res, 401, {});
      return send(res, 200, { offers: [{ id: 'ij-1', title: 'Closer de ventas high ticket', author: { name: 'Acme' }, city: 'Madrid', province: { value: 'Madrid' }, link: 'https://www.infojobs.net/oferta-ij-1', salaryDescription: '30.000 €/año', published: '2026-10-15T08:00:00Z' }] });
    }
    if (url.pathname === '/v1/api/jobs/es/search/1') {
      if (url.searchParams.get('app_key') !== 'good-key-1234') return send(res, 401, {});
      return send(res, 200, { results: [{ id: 123, title: 'Closer comercial remoto', company: { display_name: 'Beta' }, location: { display_name: 'Barcelona, España' }, redirect_url: 'https://www.adzuna.es/details/123', created: '2026-10-14T08:00:00Z', description: 'Buscamos una persona con experiencia en ventas para incorporar al equipo comercial de la empresa.' }] });
    }
    if (url.pathname === '/api/good-key-1234' && req.method === 'POST') {
      return send(res, 200, { jobs: [{ id: 77, title: 'Setter de ventas', company: 'Gamma', location: 'Valencia', link: 'https://es.jooble.org/desc/77', snippet: 'Llama a leads para agendar citas de ventas con el equipo.', updated: '2026-10-13T08:00:00Z' }] });
    }
    // Tablas de actores y ejecuciones de Apify (PostgREST simulado).
    if (url.pathname === '/rest/v1/apify_actors') {
      const q = Object.fromEntries(url.searchParams); const id = q.id?.replace('eq.', '');
      if (req.method === 'POST') { state.apifyActors.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...body }); return send(res, 201, {}); }
      if (req.method === 'PATCH') { const src = q.source?.startsWith('eq.') ? decodeURIComponent(q.source.slice(3)) : null; for (const a of state.apifyActors) if (id ? a.id === id : a.source === src) Object.assign(a, body); return send(res, 204, {}); }
      if (req.method === 'DELETE') { state.apifyActors = state.apifyActors.filter(a => a.id !== id); state.apifyRuns = state.apifyRuns.filter(r => r.actor_id !== id); return send(res, 204, {}); }
      return send(res, 200, state.apifyActors);
    }
    if (url.pathname === '/rest/v1/apify_runs') {
      const q = Object.fromEntries(url.searchParams); const rid = q.run_id?.replace('eq.', '');
      if (req.method === 'POST' && state.failRunPost) return send(res, 500, {});
      if (req.method === 'POST') { state.apifyRuns.unshift({ id: crypto.randomUUID(), started_at: new Date().toISOString(), finished_at: null, items_total: null, harvested: 0, cost_usd: null, error: null, ...body }); return send(res, 201, {}); }
      if (req.method === 'PATCH') { Object.assign(state.apifyRuns.find(r => r.run_id === rid) ?? {}, body); return send(res, 204, {}); }
      let rows = [...state.apifyRuns]; if (q.started_at?.startsWith('gte.')) rows = rows.filter(r => r.started_at >= decodeURIComponent(q.started_at.slice(4)));
      return send(res, 200, rows.slice(0, Number(q.limit) || 100));
    }
    // API de Apify simulada: solo la clave «good-key-1234» es válida.
    const apifyMatch = url.pathname.match(/^\/v2\/(acts\/([^/]+)\/(builds\/default|runs)|actor-runs\/([^/]+)|datasets\/([^/]+)\/items)$/);
    if (apifyMatch) {
      if (bearer !== 'good-key-1234') return send(res, 401, {});
      if (state.apifyFailActors?.has(apifyMatch[2]) && apifyMatch[3]) return send(res, 404, {}); // buscador «caído» en pruebas de repuestos
      if (apifyMatch[3] === 'builds/default') {
        const strict = apifyMatch[2].includes('strict');
        return send(res, 200, { data: { inputSchema: JSON.stringify({ properties: strict ? { mandatoryField: { type: 'string' }, search_term: { type: 'string' } } : { search_term: { type: 'string' }, location: { type: 'string' }, results_wanted: { type: 'integer' }, hours_old: { type: 'integer' }, country_indeed: { type: 'string' }, site_name: { type: 'array', items: { type: 'string' } }, proxyConfiguration: { type: 'object' } }, required: strict ? ['mandatoryField'] : ['search_term'] }) } });
      }
      if (apifyMatch[3] === 'runs' && req.method === 'POST') {
        const n = state.apifyCalls.length + 1; state.apifyCalls.push({ actor: apifyMatch[2], query: Object.fromEntries(url.searchParams), input: body, auth: bearer });
        return send(res, 201, { data: { id: 'RUN' + n + 'abcdef', defaultDatasetId: 'DS' + n, status: 'RUNNING' } });
      }
      if (apifyMatch[4]) return send(res, 200, { data: { status: state.apifyStatus, defaultDatasetId: 'DS1', usageTotalUsd: 0.07 } });
      if (apifyMatch[5]) { const o = Number(url.searchParams.get('offset')) || 0, l = Number(url.searchParams.get('limit')) || 100; return send(res, 200, state.apifyItems.slice(o, o + l)); }
    }
    // Proveedores externos simulados: solo la clave «good-key» es válida.
    const key = bearer || url.searchParams.get('api_key');
    if (url.pathname === '/domains' && key === 'restricted-key-1234') return send(res, 401, { name: 'restricted_api_key' }); // Resend: clave de solo envío
    if (['/v2/users/me', '/account.json', '/openai/v1/models', '/v1/models', '/domains'].includes(url.pathname)) { state.providerCalls = (state.providerCalls ?? 0) + 1; return send(res, key === 'good-key-1234' ? 200 : 401, {}); }
    send(res, 404, {});
  }).listen(authPort);

  // Motor cloud simulado: mismas reglas de payload que versionPayloadError del Worker (campos permitidos).
  const ALLOWED = ['headline', 'role', 'short_summary', 'what_they_are_looking_for', 'what_you_would_do', 'why_it_may_be_interesting', 'compensation_summary', 'location_summary', 'experience_summary', 'language_requirements', 'application_type', 'application_url', 'next_step'];
  state.patches = []; state.verifies = [];
  state.opps = [
    { id: 'opp-1', job_id: 'job-1', original_title: 'Closer de ventas B2B (remoto)', company: 'Acme Servicios', source_url: 'https://example.com/a', source: 'jobtoday', editorial_status: 'draft', opportunity_status: 'verifying', connection_type: 'external_application', created_at: '2026-10-15T08:00:00Z', updated_at: '2026-10-15T08:00:00Z', location: 'Madrid, España' },
    { id: 'opp-2', job_id: 'job-2', original_title: 'Setter y Closer de ventas', company: 'Beta Growth', source_url: 'https://example.com/b', source: 'freehire-latam', editorial_status: 'draft', opportunity_status: 'verifying', connection_type: 'external_application', created_at: '2026-10-14T08:00:00Z', updated_at: '2026-10-14T08:00:00Z', location: 'Austin, Texas' },
    { id: 'opp-3', job_id: 'job-3', original_title: 'Desarrollador Backend', company: 'Gamma', source_url: 'https://example.com/c', source: 'himalayas', editorial_status: 'draft', opportunity_status: 'verifying', connection_type: 'external_application', created_at: '2026-10-13T08:00:00Z', updated_at: '2026-10-13T08:00:00Z', location: 'Remoto' },
  ];
  const engine = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const body = ['POST', 'PATCH'].includes(req.method) ? await read(req) : {};
    if (state.engineDown && url.pathname.startsWith('/v1/')) return send(res, 503, { detail: 'Site temporarily unavailable' });
    if (url.pathname === '/page/ok') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<h1>Closer de ventas en Madrid</h1>'); }
    if (url.pathname === '/page/gone') return send(res, 404, {});
    if (url.pathname === '/api/status') return send(res, 200, { catalog_active: 12, raw_items: 300, latest_run: { day: '2026-10-16', status: 'completed', completed_at: '2026-10-16T08:00:00Z', sources: [] } });
    if (url.pathname === '/api/funnel') return send(res, 200, { totales: { elegible: 9 }, sources: [{ code: 'jobtoday', name: 'JobToday España', revisadas: 16, catalogo: 10, elegible: 4, seleccionada: 1, run_status: 'completed', roles: { closer: 3, account_executive: 1 } }, { code: 'ats-ashby-pennylane', name: 'Pennylane', revisadas: null, catalogo: 0, elegible: 0, seleccionada: 0, run_status: 'failed', fuente: 'HTTP 401', roles: {} }, { code: 'jobtoday-closers', name: 'JobToday Closers', revisadas: 5, catalogo: 5, elegible: 5, seleccionada: 0, run_status: 'completed', roles: { closer: 4 } }] });
    if (url.pathname === '/api/audit') return send(res, 200, { day: '2026-10-16', slugs: [{ source: 'jobtoday', slug: 'closer-de-ventas', status: 'ok', http_status: 200, canonical_url: null }] });
    if (url.pathname === '/v1/opportunities/search' && req.method === 'POST') {
      const mk = n => Array.from({ length: n }, (_, i) => ({ id: 'v' + i, role_label: 'Closer', original_title: 'Closer ' + i, company: 'C' + i, compensation: 'No publicada', location: 'Madrid', modality: 'Remoto', source_name: 'jobtoday.com', source_url: 'https://x.test/' + i, published_at: null }));
      const items = body.role === 'closer' ? mk(7) : mk(12); return send(res, 200, { items, total: items.length, selection_total: 0 });
    }
    if (!url.pathname.startsWith('/v1/admin/opportunities')) return send(res, 404, {});
    if (req.headers['x-admin-token'] !== 'engine-token') return send(res, 401, { detail: 'no' });
    const m = url.pathname.match(/^\/v1\/admin\/opportunities\/([^/]+)(\/verify)?$/);
    if (!m) {
      const status = url.searchParams.get('status');
      const items = state.opps.filter(o => !status || o.editorial_status === status).map(({ location, ...o }) => o);
      const counts = {}; for (const o of state.opps) counts[o.editorial_status] = (counts[o.editorial_status] ?? 0) + 1;
      return send(res, 200, { items, total: items.length, counts });
    }
    const opp = state.opps.find(o => o.id === m[1]); if (!opp) return send(res, 404, { detail: 'Oportunidad no encontrada' });
    if (m[2] && req.method === 'POST') { state.verifies.push(opp.id); return send(res, 200, { result: 'open', reason_code: 'content_matches', checked_at: new Date().toISOString(), valid_until: null, method: 'GET', opportunity_status: 'active', next_step_enabled: true, status_reason: null }); }
    if (req.method === 'PATCH') {
      const unknown = Object.keys(body.version_payload ?? {}).filter(k => !ALLOWED.includes(k));
      if (unknown.length) return send(res, 422, { detail: 'Campos no permitidos en version_payload: ' + unknown.sort().join(', ') });
      state.patches.push({ id: opp.id, status: body.editorial_status, payload: body.version_payload }); opp.editorial_status = body.editorial_status;
      return send(res, 200, { id: opp.id, version: 2, editorial_status: body.editorial_status });
    }
    return send(res, 200, { ...opp, version: 1,
      // Payload tal como lo escribe el collector (raw-shape): trae campos que el PATCH NO admite.
      version_payload: { title: opp.original_title, company: opp.company, location: opp.location, url: opp.source_url, salary: null, posted_at: null, application_type: 'unknown', next_step: { enabled: false } },
      job_snapshot: { title: opp.original_title, company: opp.company, location: opp.location, salary: null, posted_at: null, source_url: opp.source_url, source: opp.source },
      vigencia: { expires_at: null, activa: true }, verificacion: { last_verified_at: null, verified_until: null, status_reason: null } });
  }).listen(enginePort);
  return { state, close: () => { auth.close(); engine.close(); } };
}
