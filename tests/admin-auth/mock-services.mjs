// Servicios simulados para probar el acceso al panel sin tocar el Supabase real:
// GoTrue (token/user/recover/logout/admin users), PostgREST (admin_users) y el motor cloud (lecturas).
import http from 'node:http';

export function startMocks({ authPort, enginePort }) {
  const state = {
    users: new Map([['owner@test.dev', { id: 'u1', password: 'Correcta-12345' }]]),
    admins: [{ email: 'owner@test.dev', role: 'owner', invited_by: 'bootstrap', created_at: '2026-10-16T00:00:00Z' }],
    connections: new Map(), tokens: new Map(), recoverCalls: [], recoverTokens: new Map(),
  };
  const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
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
      if (!state.admins.some(a => a.email === body.email)) return send(res, 500, { msg: 'signup_disabled' }); // espejo del trigger de BD
      if (state.users.has(body.email)) return send(res, 422, { msg: 'exists' });
      state.users.set(body.email, { id: 'u' + (state.users.size + 1), password: null }); return send(res, 200, { id: 'new', email: body.email });
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
    // Proveedores externos simulados: solo la clave «good-key» es válida.
    const key = bearer || url.searchParams.get('api_key');
    if (['/v2/users/me', '/account.json', '/openai/v1/models', '/v1/models'].includes(url.pathname)) { state.providerCalls = (state.providerCalls ?? 0) + 1; return send(res, key === 'good-key-1234' ? 200 : 401, {}); }
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
