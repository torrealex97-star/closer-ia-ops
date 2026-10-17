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
export const privateAddress = (ip: string): boolean => {
  const v = ip.toLowerCase();
  if (v.includes(':')) return v === '::1' || v === '::' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('::ffff:') && privateAddress(v.slice(7));
  const p = v.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
};

// Comprueba esquema/host y que el DNS no resuelva a una red interna. `resolve` es inyectable para pruebas.
export async function assertPublicUrl(rawUrl: string, resolve: (host: string) => Promise<string[]> = async h => (await lookup(h, { all: true })).map(x => x.address)): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  // Solo para pruebas con servidores simulados: host:port EXACTO fijado por entorno (nunca viene de datos externos).
  const testHost = process.env.URL_GUARD_TEST_ALLOW;
  try { if (testHost && new URL(rawUrl).host === testHost) return { ok: true, url: new URL(rawUrl) }; } catch { /* url inválida: sigue el flujo normal */ }
  const check = hostAllowed(rawUrl);
  if (!check.ok) return check;
  try { if ((await resolve(check.url.hostname)).some(privateAddress)) return { ok: false, reason: 'resuelve_a_red_interna' }; }
  catch { return { ok: false, reason: 'dns' }; }
  return check;
}
