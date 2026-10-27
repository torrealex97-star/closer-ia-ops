import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../../lib/adminAuth';
import { auditApprovedByRules } from '../../../../../lib/ruleAudit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Auditoría del catálogo: qué ofertas ya aprobadas retiraría hoy la regla, con su motivo.
// SOLO LECTURA: no escribe nada. Retirar sigue siendo una decisión con botón propio en el panel.
export async function GET(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const audit = await auditApprovedByRules().catch(() => null);
  if (!audit) return Response.json({ detail: 'No se pudo leer el catálogo para auditarlo.' }, { status: 503 });
  return withCookies(Response.json({ ...audit, read_only: true }, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
