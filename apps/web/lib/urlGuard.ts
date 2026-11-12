// Guardián de URLs salientes (SSRF) que corre igual en Node y en Cloudflare Workers.
//
// POR QUÉ ESTÁ REESCRITO (sesión 147): la versión anterior resolvía el DNS con `node:dns/promises`
// y conectaba a la IP validada (`node:http`/`node:https`), lo que en workerd no existe. Sin DNS no
// hay «IP fijada», así que la defensa cambia de forma: en vez de comprobar a dónde resuelve un
// nombre arbitrario, se decide **qué nombres se piden**. Es una allowlist, y falla cerrada.
//
// Reglas, en orden:
//   1. http/https, sin credenciales en la URL y solo puertos 80/443 (o ninguno).
//   2. Nada de IP literales, en ninguna forma (decimal, octal, hexadecimal, IPv6, con o sin corchetes).
//   3. Nada de hosts de una sola etiqueta ni TLD internos (localhost, .local, .internal, .lan…).
//   4. Nada de redes sociales (no se verifican enlaces de LinkedIn o Telegram).
//   5. El dominio (eTLD+1) tiene que estar en la allowlist: los portales y ATS medidos en el catálogo
//      real, más lo que declare `URL_GUARD_ALLOWED_HOSTS` (separado por comas).
//   6. Las redirecciones NO se siguen: se devuelve `location` y el llamador revalida CADA salto con
//      estas mismas reglas, así que un 302 a `http://127.0.0.1/` muere en el salto siguiente.
//
// Lo que esta versión NO puede hacer, y se dice: no comprueba el DNS, así que un dominio de la
// allowlist que resuelva a una red interna (DNS rebinding) no se detecta aquí. Cloudflare Workers no
// permite `fetch` a direcciones privadas, y en Node el riesgo queda acotado a dominios ya aprobados.
// La allowlist se mide sobre datos reales y crece a mano: una fuente nueva que no esté en ella no se
// verifica (queda `skipped`/`unknown`, nunca «open» inventado).

import { isIP } from './ipLiteral';

const SOCIAL = /(^|\.)(linkedin|facebook|instagram|twitter|tiktok|youtube|t|wa|whatsapp|telegram|reddit|threads)\.(com|me|net)$|(^|\.)x\.com$/i;

// Dominios medidos en el catálogo real (4.540 anuncios de `job_postings`, 2026-11-12): los 112
// dominios con al menos 2 anuncios cubren el 98,2 % de las URLs. `t.me` queda fuera a propósito
// (Telegram es red social y ya la rechaza la regla 4).
export const ALLOWED_SITES: readonly string[] = [
  'adp.com', 'aligntech.com', 'amazon.jobs', 'applicantpro.com', 'applytojob.com', 'aquaservice.com',
  'ashbyhq.com', 'bamboohr.com', 'beaire.com', 'breezy.hr', 'careers-page.com', 'catho.com.br',
  'catonetworks.com', 'catsone.com', 'comeet.com', 'computrabajo.com', 'csod.com', 'datadoghq.com',
  'dayforcehcm.com', 'dcycle.io', 'deel.com', 'dover.com', 'eightfold.ai', 'empregos.com.br',
  'epi-industries.com', 'epreselec.com', 'etam.com', 'evotym.com', 'factorial.com', 'factorial.es',
  'factorialhr.com.br', 'factorialhr.pt', 'fpsinc.com', 'freelancer.com', 'gallagher.com',
  'geovictoria.com', 'getonbrd.com', 'google.com', 'gostudent.org', 'greenhouse.io', 'grupomayoral.com',
  'guaw.com', 'gupy.io', 'hibob.com', 'himalayas.app', 'hireology.com', 'hiringroom.com', 'hrmdirect.com',
  'icims.com', 'imancorp.es', 'imanglobalconsulting.es', 'infojobs.com.br', 'infojobs.net', 'infor.com',
  'inhire.app', 'innovamat.com', 'itau.com.br', 'jibeapply.com', 'jobindex.dk', 'jobnet.dk',
  'jobtoday.com', 'join.com', 'kaspersky.ru', 'lacasadelascarcasas.com', 'leroymerlin.es', 'lever.co',
  'livestorm.co', 'magnific.com', 'mews.com', 'microsoft.com', 'milbby.com', 'monestcapital.com',
  'mongodb.com', 'myworkdayjobs.com', 'myworkdaysite.com', 'netskope.com', 'obramat.es',
  'oraclecloud.com', 'paycomonline.net', 'personio.com', 'pinpointhq.com', 'prometeotalent.com',
  'pronovias.com', 'quickin.io', 'rankings.io', 'recruitee.com', 'recruitingbypaycor.com', 'remedio.io',
  'revmed.com', 'rippling.com', 'saashr.com', 'saldum.com', 'sentinelone.com', 'silbon.es',
  'smartrecruiters.com', 'solides.com.br', 'startup.jobs', 'stripe.com', 'talentclue.com', 'taleo.net',
  'teamtailor.com', 'topdoctorsgroup.com', 'torre.ai', 'uber.com', 'ultipro.com', 'viterbit.site',
  'vml.com', 'weworkremotely.com', 'whatjobs.com', 'workable.com', 'zohorecruit.com',
];

// Sufijos de segundo nivel que cuentan como «final» del dominio: sin esto, `x.com.br` se leería como
// el sitio `com.br` y una allowlist de `com.br` abriría medio Brasil.
const MULTI_LABEL = new Set([
  'com.br', 'co.uk', 'org.uk', 'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.cl', 'com.uy', 'com.ec',
  'com.py', 'com.es', 'co.es', 'com.pt', 'com.fr', 'co.nz', 'com.au',
]);

const INTERNAL_SUFFIX = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa)$/;

const envOf = (name: string): string | undefined => {
  try { return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name]; }
  catch { return undefined; }
};

/** Sitios permitidos: los medidos + `URL_GUARD_ALLOWED_HOSTS` (lista separada por comas). */
export function allowedSites(extra: string | undefined = envOf('URL_GUARD_ALLOWED_HOSTS')): string[] {
  const added = (extra ?? '').split(',').map(s => s.trim().toLowerCase().replace(/^\.+/, '')).filter(Boolean);
  return [...new Set([...ALLOWED_SITES, ...added])];
}

/** Sitio (eTLD+1 aproximado) de un host: `jobs.lever.co` → `lever.co`, `x.empresa.com.br` → `empresa.com.br`. */
export function siteOf(host: string): string {
  const clean = host.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  const parts = clean.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  return MULTI_LABEL.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

// IPv4 dentro de IPv6: `::ffff:127.0.0.1` llega a veces en forma HEXADECIMAL (`::ffff:7f00:1`). Sin
// convertirla, el guardián daba por pública una dirección interna.
const mappedV4 = (v: string): string | null => {
  if (!v.startsWith('::ffff:')) return null;
  const rest = v.slice(7);
  if (rest.includes('.')) return rest;
  const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
};

/** ¿La dirección es de una red que no se debe tocar desde el servidor? (pura, sin DNS ni red). */
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

// Cualquier forma de escribir una IP en un host: cuadrada, decimal suelto, octal/hexadecimal, IPv6.
const looksLikeIp = (host: string): boolean =>
  host.startsWith('[') || host.includes(':') || isIP(host) !== 0 || /^\d+$/.test(host) || /^\d+(\.\d+){0,3}$/.test(host) || /^0x[0-9a-f]+$/i.test(host);

export type HostCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Valida una URL de forma estática (sin red). `allowlist: null` desactiva el paso 5 — solo para
 * pruebas y llamadas internas que ya saben qué host piden; el camino de datos externos nunca lo usa.
 */
export function hostAllowed(rawUrl: string, opts: { allowlist?: readonly string[] | null } = {}): HostCheck {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: 'url_invalida' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'protocolo' };
  if (u.username || u.password) return { ok: false, reason: 'credenciales_en_url' };
  if (u.port && u.port !== '80' && u.port !== '443') return { ok: false, reason: 'puerto' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'host_vacio' };
  // Primero «¿es una IP escrita de cualquier forma?» y después «¿es un nombre interno?». `privateAddress`
  // trabaja sobre DIRECCIONES, no sobre nombres: preguntarle por `localhost` daría «privada» por accidente
  // y convertiría un host interno en una IP literal, con la razón equivocada.
  if (looksLikeIp(host)) return { ok: false, reason: 'ip_literal' };
  if (!host.includes('.') || INTERNAL_SUFFIX.test(host)) return { ok: false, reason: 'host_interno' };
  if (SOCIAL.test(host)) return { ok: false, reason: 'red_social' };
  if (opts.allowlist !== null) {
    const sites = opts.allowlist ?? allowedSites();
    if (!sites.includes(siteOf(host))) return { ok: false, reason: 'host_no_autorizado' };
  }
  return { ok: true, url: u };
}

// Solo para pruebas con servidores simulados: host:port EXACTO fijado por entorno (nunca viene de datos externos).
const testAllowed = (rawUrl: string): boolean => {
  const testHost = envOf('URL_GUARD_TEST_ALLOW');
  if (!testHost) return false;
  try { return new URL(rawUrl).host === testHost; } catch { return false; }
};

/** Igual que `hostAllowed`, más la excepción explícita de pruebas. Sin DNS: no hay resolución que hacer. */
export async function assertPublicUrl(rawUrl: string, opts: { allowlist?: readonly string[] | null } = {}): Promise<HostCheck> {
  if (testAllowed(rawUrl)) return { ok: true, url: new URL(rawUrl) };
  return hostAllowed(rawUrl, opts);
}

export type GuardedResult = { ok: true; status: number; location: string | null; text: string } | { ok: false; reason: string };

/**
 * GET acotado y guardado. NO sigue redirecciones: devuelve `location` para que el llamador revalide
 * el salto siguiente con `hostAllowed` (así una redirección a una IP literal o a un host fuera de la
 * allowlist no se pide nunca). Tope de bytes y de tiempo.
 */
export async function guardedGet(
  rawUrl: string,
  opts: { timeoutMs: number; maxBytes?: number; fetchImpl?: typeof fetch; allowlist?: readonly string[] | null } = { timeoutMs: 10000 },
): Promise<GuardedResult> {
  const check = await assertPublicUrl(rawUrl, { allowlist: opts.allowlist });
  if (!check.ok) return check;
  const doFetch = opts.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (!doFetch) return { ok: false, reason: 'sin_fetch' };
  const maxBytes = opts.maxBytes ?? 200000;
  let response: Response;
  try {
    response = await doFetch(check.url.href, {
      method: 'GET', redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(1, Math.floor(opts.timeoutMs))),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WDC-verifier)', Accept: 'text/html,*/*;q=0.8' },
    });
  } catch { return { ok: false, reason: 'red' }; }
  const status = response.status;
  if (status >= 300 && status < 400) {
    try { await response.body?.cancel(); } catch { /* el cuerpo del 3xx no interesa */ }
    return { ok: true, status, location: response.headers.get('location'), text: '' };
  }
  let text = '';
  try {
    const reader = response.body?.getReader();
    if (!reader) text = (await response.text()).slice(0, maxBytes); // runtime sin streams: se corta al leer
    else {
      const decoder = new TextDecoder();
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value?.byteLength ?? 0;
        if (size > maxBytes) { text += decoder.decode(value.slice(0, Math.max(0, maxBytes - (size - (value?.byteLength ?? 0))))); try { await reader.cancel(); } catch { /* ya cortado */ } break; }
        text += decoder.decode(value, { stream: true });
      }
    }
  } catch { /* cuerpo ilegible: se devuelve lo leído, que puede ser vacío */ }
  return { ok: true, status, location: null, text: text.slice(0, maxBytes) };
}
