// Registro de actividad de la alumna desde el navegador. Nunca lanza ni bloquea la pantalla: sin sesión (la vista de
// oportunidades puede estar abierta) o sin tabla, el ejercicio se hace igual y simplemente no queda en su progreso.
export type ActivityBody =
  | { kind: 'training_review'; ref: string; detail: { met: number; total: number } }
  | { kind: 'training_exam'; ref: 'final'; detail: { correct: number; total: number } }
  | { kind: 'practice'; ref: string; score: number; detail?: { axes?: Record<string, number>; difficulty?: string; mode?: 'texto' | 'voz' } };

export async function logActivity(body: ActivityBody): Promise<{ saved: boolean; status: number }> {
  try {
    const response = await fetch('/api/student/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { saved: response.ok, status: response.status };
  } catch { return { saved: false, status: 0 }; }
}
