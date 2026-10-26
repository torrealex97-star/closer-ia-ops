import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

// Protección SSRF compartida: toda petición del servidor a una URL que viene de fuentes externas pasa por aquí.
const SOCIAL = /(^|\.)(linkedin|facebook|instagram|twitter|tiktok|youtube|t|wa|whatsapp|telegram|reddit|threads)\.(com|me|net)$|(^|\.)x\.com$/i;
export function hostAllowed(rawUrl: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: 'url_invalida' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'protocolo' };
  if (u.username || u.password) return { ok: false, reason: 'credenciales_en_url' };
  if (u.port && u.port !== '80' && u.port !== '443') return { ok: false, reason: 'puerto' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (isIP(host) || host.startsWith('[') || /^\d+$/.test(host) || /^0x/i.test(host)) return { ok: false, reason: 'ip_literal' };
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host)) return { ok: false, reason: 'host_interno' };
  if (SOCIAL.test(host)) return { ok: false, reason: 'red_social' };
  return { ok: true, url: u };
}
// IPv4 dentro de IPv6: `::ffff:127.0.0.1` llega a veces en forma HEXADECIMAL (`::ffff:7f00:1`, lo que devuelven
// algunos resolvers y servicios DoH). Sin convertirla, el guardián daba por pública una dirección interna.
const mappedV4 = (v: string): string | null => {
  if (!v.startsWith('::ffff:')) return null;
  const rest = v.slice(7);
  if (rest.includes('.')) return rest;
  const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
};
export const privateAddress = (ip: string): boolean => {
  const v = ip.trim().toLowerCase();
  if (v.includes(':')) {
    const mapped = mappedV4(v);
    return mapped ? privateAddress(mapped) : v === '::1' || v === '::' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  const p = v.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
};

// Comprueba esquema/host y que el DNS no resuelva a una red interna. `resolve` es inyectable para pruebas.
export async function assertPublicUrl(rawUrl: string, resolve: (host: string) => Promise<string[]> = async h => (await lookup(h, { all: true })).map(x => x.address)): Promise<{ ok: true; url: URL; address?: string } | { ok: false; reason: string }> {
  // Solo para pruebas con servidores simulados: host:port EXACTO fijado por entorno (nunca viene de datos externos).
  const testHost = process.env.URL_GUARD_TEST_ALLOW;
  try { if (testHost && new URL(rawUrl).host === testHost) return { ok: true, url: new URL(rawUrl) }; } catch { /* url inválida: sigue el flujo normal */ }
  const check = hostAllowed(rawUrl);
  if (!check.ok) return check;
  let addresses: string[];
  try { addresses = await resolve(check.url.hostname); } catch { return { ok: false, reason: 'dns' }; }
  if (!addresses.length) return { ok: false, reason: 'dns' };
  if (addresses.some(privateAddress)) return { ok: false, reason: 'resuelve_a_red_interna' };
  return { ok: true, url: check.url, address: addresses[0] };
}

// GET con la IP FIJADA: la dirección validada es la que se usa para conectar (el DNS no se vuelve a consultar), así que un
// nombre que cambie de respuesta entre la comprobación y la petición (DNS rebinding) no puede llevar a una red interna.
// Host y SNI siguen siendo el nombre original. No sigue redirecciones: devuelve `location` para que el llamador revalide cada salto.
export type PinnedResult = { ok: true; status: number; location: string | null; text: string } | { ok: false; reason: string };
export async function pinnedGet(rawUrl: string, opts: { timeoutMs: number; maxBytes?: number; resolve?: (host: string) => Promise<string[]> }): Promise<PinnedResult> {
  const check = await assertPublicUrl(rawUrl, opts.resolve);
  if (!check.ok) return check;
  const maxBytes = opts.maxBytes ?? 200000, u = check.url, address = check.address;
  const client = u.protocol === 'https:' ? https : http;
  return new Promise<PinnedResult>(resolve => {
    const done = (r: PinnedResult) => resolve(r);
    try {
      const req = client.request({
        protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: `${u.pathname}${u.search}`, method: 'GET', servername: isIP(u.hostname) ? undefined : u.hostname,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WDC-verifier)', Accept: 'text/html,*/*;q=0.8' }, signal: AbortSignal.timeout(Math.max(1, Math.floor(opts.timeoutMs))),
        ...(address ? { lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => { const family = isIP(address); o?.all ? cb(null, [{ address, family }]) : cb(null, address, family); }) as never } : {}),
      }, res => {
        const status = res.statusCode ?? 0, location = typeof res.headers.location === 'string' ? res.headers.location : null;
        if (status >= 300 && status < 400) { res.resume(); return done({ ok: true, status, location, text: '' }); }
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (c: Buffer) => { size += c.length; if (size <= maxBytes) chunks.push(c); else { res.destroy(); } });
        res.on('close', () => done({ ok: true, status, location, text: Buffer.concat(chunks).toString('utf8').slice(0, maxBytes) }));
        res.on('error', () => done({ ok: true, status, location, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', () => done({ ok: false, reason: 'red' }));
      req.end();
    } catch { done({ ok: false, reason: 'red' }); }
  });
}
