import { ORG, scrub } from './external';
import { serviceRest } from './supabaseAuth';

// Leads B2B (anunciantes con anuncios activos que podrían necesitar closers). Solo datos de EMPRESA: sin personas ni
// contactos. Alta manual o importación por el panel; aquí NO se rasca ninguna biblioteca de anuncios ni se contacta a nadie.
export const LEAD_STATUSES = ['nuevo', 'contactado', 'respondio', 'colocacion', 'descartado'] as const;
export const LEAD_MARKETS = ['ES', 'LATAM', 'US_LATINO', 'MULTI'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type Lead = { advertiser: string; market: string; ad_library_url: string | null; landing_url: string | null; vertical: string | null; cta: string | null; weeks_active: number | null };

const clip = (v: unknown, n: number) => typeof v === 'string' || typeof v === 'number' ? scrub(String(v)).slice(0, n) || null : null;
const httpUrl = (v: unknown) => { const t = clip(v, 1000); return t && /^https?:\/\/[^\s]+$/i.test(t) ? t : null; };

export function sanitizeLead(input: unknown): Lead | null {
  if (!input || typeof input !== 'object') return null;
  const c = input as Record<string, unknown>;
  const advertiser = clip(c.advertiser, 200);
  if (!advertiser) return null;
  const market = typeof c.market === 'string' && (LEAD_MARKETS as readonly string[]).includes(c.market) ? c.market : 'MULTI';
  const w = Number(c.weeks_active);
  return { advertiser, market, ad_library_url: httpUrl(c.ad_library_url), landing_url: httpUrl(c.landing_url), vertical: clip(c.vertical, 80), cta: clip(c.cta, 120), weeks_active: Number.isFinite(w) && w >= 0 && w <= 520 ? Math.round(w * 10) / 10 : null };
}

// Importa hasta 200 leads. Los ya existentes (org + anunciante + mercado) solo actualizan datos y `last_seen_at`:
// NUNCA tocan `status` ni `notes` (lo que una persona haya trabajado se conserva).
export async function importLeads(input: unknown[]): Promise<{ received: number; accepted: number; rejected: number }> {
  const received = Math.min(input.length, 200);
  const clean = input.slice(0, 200).map(sanitizeLead).filter((l): l is Lead => l !== null);
  const unique = [...new Map(clean.map(l => [`${l.advertiser.toLowerCase()}|${l.market}`, l])).values()];
  if (!unique.length) return { received, accepted: 0, rejected: received };
  const now = new Date().toISOString();
  const response = await serviceRest('b2b_leads?on_conflict=org_id,advertiser,market', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(unique.map(l => ({ org_id: ORG, ...l, last_seen_at: now }))),
  });
  if (!response.ok) throw new Error('No se pudo guardar los leads.');
  return { received, accepted: unique.length, rejected: received - unique.length };
}

export async function listLeads(opts: { status?: string; limit?: number } = {}): Promise<Array<Lead & { id: string; status: LeadStatus; notes: string | null; first_seen_at: string; last_seen_at: string }> | null> {
  const q = [`org_id=eq.${ORG}`, 'select=id,advertiser,market,ad_library_url,landing_url,vertical,cta,weeks_active,status,notes,first_seen_at,last_seen_at', 'order=weeks_active.desc.nullslast,last_seen_at.desc', `limit=${Math.min(Math.max(opts.limit ?? 100, 1), 500)}`];
  if (opts.status && (LEAD_STATUSES as readonly string[]).includes(opts.status)) q.push(`status=eq.${opts.status}`);
  const response = await serviceRest(`b2b_leads?${q.join('&')}`);
  const rows = response.ok ? await response.json().catch(() => null) : null;
  return Array.isArray(rows) ? rows : null;
}

export async function setLeadStatus(ids: string[], status: string, notes?: string): Promise<number | null> {
  if (!(LEAD_STATUSES as readonly string[]).includes(status) || !ids.length || ids.length > 100 || ids.some(i => !/^[0-9a-f-]{36}$/.test(i))) return null;
  const body: Record<string, unknown> = { status };
  if (notes !== undefined) body.notes = clip(notes, 1000);
  const response = await serviceRest(`b2b_leads?org_id=eq.${ORG}&id=in.(${ids.join(',')})`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
  const rows = response.ok ? await response.json().catch(() => null) : null;
  return Array.isArray(rows) ? rows.length : null;
}
