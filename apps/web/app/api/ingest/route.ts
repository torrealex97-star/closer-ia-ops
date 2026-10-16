import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { ingest, SOURCE_RE } from '../../../lib/external';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// Entrada de candidatos de recolectores programados (p. ej. el workflow de GitHub con JobSpy).
// Solo con el token INGEST_TOKEN; sin él configurado, la ruta queda cerrada.
const tokenMatches = (given: string) => {
  const expected = process.env.INGEST_TOKEN ?? '';
  const a = Buffer.from(given), b = Buffer.from(expected);
  return expected.length >= 24 && a.length === b.length && timingSafeEqual(a, b);
};

export async function POST(request: NextRequest) {
  if (!process.env.INGEST_TOKEN) return Response.json({ detail: 'La entrada de candidatos no está configurada.' }, { status: 503 });
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!tokenMatches(given)) return Response.json({ detail: 'No autorizado.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { source?: unknown; via?: unknown; candidates?: unknown; note?: unknown } | null;
  if (!body || typeof body.source !== 'string' || !SOURCE_RE.test(body.source) || !Array.isArray(body.candidates)) {
    return Response.json({ detail: 'Cuerpo no válido: se espera { source, candidates[] }.' }, { status: 422 });
  }
  try {
    const result = await ingest(body.source, typeof body.via === 'string' ? body.via.slice(0, 40) : 'ingest', body.candidates, typeof body.note === 'string' ? body.note.slice(0, 300) : undefined);
    return Response.json({ ok: true, ...result });
  } catch (err) { return Response.json({ detail: (err as Error).message }, { status: 503 }); }
}
