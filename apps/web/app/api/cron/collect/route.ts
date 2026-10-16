import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { collectAll } from '../../../../lib/collectors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Vercel Cron llama aquí con `Authorization: Bearer $CRON_SECRET`. Recoge las APIs oficiales que tengan clave guardada.
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET ?? '';
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (expected.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ detail: 'No autorizado.' }, { status: 401 });
  return Response.json({ outcomes: await collectAll('cron') });
}
