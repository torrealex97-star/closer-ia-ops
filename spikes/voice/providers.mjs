// Interfaces reemplazables (ADR-013). Nada aquí habla con la red: son los simuladores del spike.
// LLMProvider:  async reply({ system, history }) => string        (lanza si el proveedor cae)
// VoiceProvider: { stt(audio) => string, tts(text) => audio }     (en el spike el «audio» es el propio texto)
// Los proveedores reales (Pipecat + STT/LLM/TTS con claves) se enchufan detrás de las mismas firmas: ver RUNBOOK.md.

/** Cliente simulado: responde con las frases de la personalidad según lo que dijo la vendedora. Determinista. */
export function scriptedLLM(personality) {
  let i = 0;
  return {
    name: 'scripted',
    async reply({ history }) {
      const last = [...history].reverse().find(h => h.role === 'user')?.text ?? '';
      const rule = personality.rules.find(r => new RegExp(r.when, 'i').test(last));
      const line = rule ? rule.say : personality.fallback[i++ % personality.fallback.length];
      return line;
    },
  };
}

/** Proveedor caído: el spike debe DECLARAR el fallo, no inventar una respuesta. */
export const downLLM = { name: 'down', async reply() { throw new Error('proveedor_no_disponible'); } };

/** «Voz» de texto: STT/TTS identidad (en producción: Whisper/Kokoro u otros detrás de Pipecat). */
export const textVoice = { name: 'text', stt: audio => String(audio), tts: text => String(text) };
