import { NextRequest } from 'next/server';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { activityWindow, studentProgress } from '../../../../lib/studentActivity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Progreso propio: solo con sesión de alumna. Señales de uso de la ventana
// pedida (7, 30 o 90 días; 30 por defecto): entradas, prácticas con feedback y
// sus ejes, revisiones y examen. Sin texto libre.
export async function GET(request: NextRequest) {
  const auth = await authenticateStudent(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const progress = await studentProgress(auth.student.id, activityWindow(request.nextUrl.searchParams.get('days')));
  if (!progress) return Response.json({ detail: 'No se pudo leer tu actividad ahora mismo.' }, { status: 503 });
  return Response.json({ progress }, { headers: { 'Cache-Control': 'no-store' } });
}
