import { textVoice } from './providers.mjs';

// Tope de coste por sesión (ADR-013): turnos y caracteres. Se declara si se corta.
export const LIMITS = { maxTurns: 12, maxChars: 4000 };

/**
 * Sesión por texto: el «cliente» (LLMProvider) responde a cada intervención de la alumna.
 * Devuelve la transcripción y, si algo falla o se corta, lo DECLARA (`error`, `truncated`); nunca inventa respuestas.
 */
export async function runSession({ personality, llm, learnerTurns, voice = textVoice, limits = LIMITS }) {
  const transcript = [{ n: 0, role: 'assistant', text: voice.tts(personality.opening) }];
  const out = { personality: personality.id, transcript, truncated: false, error: null };
  let chars = transcript[0].text.length;
  for (const said of learnerTurns) {
    if (transcript.filter(t => t.role === 'user').length >= limits.maxTurns || chars > limits.maxChars) { out.truncated = true; break; }
    const text = voice.stt(said);
    transcript.push({ n: transcript.length, role: 'user', text }); chars += text.length;
    try {
      const reply = voice.tts(await llm.reply({ system: personality.system, history: transcript }));
      transcript.push({ n: transcript.length, role: 'assistant', text: reply }); chars += reply.length;
    } catch (e) { out.error = String(e.message || e); break; }
  }
  return out;
}
