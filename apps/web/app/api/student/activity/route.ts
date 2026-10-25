import { NextRequest } from 'next/server';
import { FINAL_EXAM } from '../../../../components/trainingContent';
import { originBlocked } from '../../../../lib/adminAuth';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { EXAM_PASS, recordActivity, sanitizeDetail, TRAINING_REFS, type ActivityKind } from '../../../../lib/studentActivity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Preguntas que puntúan (las de desarrollo no suman, igual que en la app).
const EXAM_TOTAL = FINAL_EXAM.filter(question => question.type === 'multiple').length;

// Registro de formación desde la app pública: SOLO se atribuye si hay sesión de
// alumna (el enlace abierto sigue funcionando, pero sin atribución). Se aceptan
// dos señales acotadas y se recalculan aquí: revisión de un ejercicio y examen.
// Nunca se guarda el texto que escribe la alumna.
type Body = { kind?: unknown; ref?: unknown; score?: unknown; detail?: unknown };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: NextRequest) {
  if (originBlocked(request)) return json({ detail: 'Origen no permitido' }, 403);
  if (Number(request.headers.get('content-length') ?? 0) > 4096) return json({ detail: 'Cuerpo demasiado grande.' }, 413);
  const auth = await authenticateStudent(request);
  if (!auth.ok) return json({ detail: auth.detail }, auth.status);

  const body = await request.json().catch(() => null) as Body | null;
  if (!body) return json({ detail: 'Cuerpo no válido.' }, 422);
  const kind = body.kind as ActivityKind;
  const ref = typeof body.ref === 'string' ? body.ref : '';

  if (kind === 'training_review') {
    if (!TRAINING_REFS.includes(ref as (typeof TRAINING_REFS)[number])) return json({ detail: 'Módulo desconocido.' }, 422);
    const detail = sanitizeDetail(kind, body.detail);
    if (!detail || typeof detail.met !== 'number' || typeof detail.total !== 'number') return json({ detail: 'Revisión incompleta.' }, 422);
    const ok = await recordActivity(auth.student.id, kind, { ref, detail });
    return ok ? json({ ok: true }, 201) : json({ detail: 'No se pudo guardar la revisión.' }, 503);
  }

  if (kind === 'training_exam') {
    if (ref !== 'final') return json({ detail: 'Examen desconocido.' }, 422);
    const detail = sanitizeDetail(kind, body.detail) ?? {};
    const correct = typeof detail.correct === 'number' ? detail.correct : null;
    const total = typeof detail.total === 'number' ? detail.total : null;
    // La nota se recalcula aquí con las preguntas reales del examen: el `score`
    // que manda el navegador no se usa nunca (ni para la nota ni para el «superado»).
    if (correct === null || total !== EXAM_TOTAL || correct > EXAM_TOTAL) {
      return json({ detail: 'Corrección incompleta: faltan las respuestas acertadas del examen.' }, 422);
    }
    const finalScore = Math.round((correct / EXAM_TOTAL) * 100);
    const stored = { correct, total: EXAM_TOTAL, passed: finalScore >= EXAM_PASS };
    const ok = await recordActivity(auth.student.id, kind, { ref, score: finalScore, detail: stored });
    return ok ? json({ ok: true, passed: stored.passed, score: finalScore }, 201) : json({ detail: 'No se pudo guardar el examen.' }, 503);
  }

  return json({ detail: 'Tipo de actividad no permitido.' }, 422);
}
