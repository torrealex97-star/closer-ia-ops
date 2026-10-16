// Servicios simulados para probar el acceso al panel sin tocar el Supabase real:
// GoTrue (token/user/recover/logout/admin users), PostgREST (admin_users) y el motor cloud (lecturas).
import http from 'node:http';

export function startMocks({ authPort, enginePort }) {
  const state = {
    users: new Map([['owner@test.dev', { id: 'u1', password: 'Correcta-12345' }]]),
    admins: [{ email: 'owner@test.dev', role: 'owner', invited_by: 'bootstrap', created_at: '2026-10-16T00:00:00Z' }],
    tokens: new Map(), recoverCalls: [], recoverTokens: new Map(),
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
    const url = new URL(req.url, 'http://x'); const body = ['POST', 'PUT'].includes(req.method) ? await read(req) : {};
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
    send(res, 404, {});
  }).listen(authPort);

  const engine = http.createServer((req, res) => {
    if (req.url.startsWith('/api/status')) return send(res, 200, { catalog_active: 12, raw_items: 300, latest_run: { day: '2026-10-16', status: 'completed', completed_at: '2026-10-16T08:00:00Z', sources: [] } });
    if (req.url.startsWith('/api/funnel')) return send(res, 200, { sources: [{ code: 'jobtoday', name: 'JobToday España', revisadas: 16, catalogo: 10, elegible: 4, seleccionada: 1, run_status: 'completed' }, { code: 'ats-ashby-pennylane', name: 'Pennylane', revisadas: null, catalogo: 0, elegible: 0, seleccionada: 0, run_status: 'failed', fuente: 'HTTP 401' }] });
    if (req.url.startsWith('/api/audit')) return send(res, 200, { day: '2026-10-16', slugs: [{ source: 'jobtoday', slug: 'closer-de-ventas', status: 'ok', http_status: 200, canonical_url: null }] });
    if (req.url.startsWith('/v1/admin/opportunities')) return req.headers['x-admin-token'] === 'engine-token' ? send(res, 200, { items: [], total: 0, counts: {} }) : send(res, 401, { detail: 'no' });
    send(res, 404, {});
  }).listen(enginePort);
  return { state, close: () => { auth.close(); engine.close(); } };
}
