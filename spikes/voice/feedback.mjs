// Informe de feedback con EVIDENCIA LITERAL (ADR-013): cada punto «observado» cita un fragmento exacto de la transcripción;
// si no hay evidencia el punto es «no observado» (no es «malo»); sin puntuaciones inventadas. Determinista, sin LLM.
export function buildFeedback(session, personality) {
  const userTurns = session.transcript.filter(t => t.role === 'user');
  const items = personality.rubric.map(c => {
    const re = new RegExp(c.evidence, 'i');
    const hit = userTurns.find(t => re.test(t.text));
    if (!hit) return { id: c.id, label: c.label, status: 'no_observado', quote: null, turn: null };
    const m = hit.text.match(re);
    const start = Math.max(0, m.index - 30), end = Math.min(hit.text.length, m.index + m[0].length + 30);
    return { id: c.id, label: c.label, status: 'observado', quote: hit.text.slice(start, end), turn: hit.n };
  });
  return {
    personality: session.personality, turns_learner: userTurns.length,
    incomplete: Boolean(session.error || session.truncated) || undefined,
    note: session.error ? `La sesión se interrumpió (${session.error}); el informe cubre solo lo dicho hasta ahí.` : session.truncated ? 'La sesión se cortó por el tope de coste.' : undefined,
    observed: items.filter(i => i.status === 'observado').length, total: items.length, items,
  };
}
