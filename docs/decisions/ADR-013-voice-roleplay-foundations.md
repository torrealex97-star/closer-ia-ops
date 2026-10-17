# ADR-013 — Base para roleplays de ventas por voz y simulaciones de entrevista (solo decisión; nada implementado)

Estado: propuesta · Fecha: 2026-10-17 · Evidencia: *inspeccionado* (ficheros LICENSE leídos en GitHub); no se ha ejecutado ni instalado nada.

## Contexto
El dueño quiere que, más adelante, la alumna practique **llamadas de ventas por voz** (la IA hace de cliente y entrega un informe de feedback) y **simulaciones de entrevista**, con personalidades intercambiables (estilo «Jarvis»). Condición de licencias para cualquier código o librería que se reutilice: **solo MIT, Apache-2.0 o BSD**. No hay ningún código de voz en el repo.

## Decisión
1. **Proveedores reemplazables.** Voz detrás de una interfaz `VoiceProvider` (STT y TTS) y razonamiento detrás de `LLMProvider` (Groq por defecto, ADR-007). Ninguna pieza concreta queda cableada; los de pago son opt-in con tope de coste por sesión.
2. **Orquestación candidata: Pipecat** (BSD-2-Clause). Alternativa: LiveKit Agents (Apache-2.0). La elección final se hace tras un spike acotado (fuera de este ADR).
3. **Personalidades = configuración versionada** (cliente escéptico, cliente con presupuesto, entrevistador de agencia…), con rúbrica de feedback propia basada en la skill `sales-engineering`. Cambiar de personalidad no cambia código.
4. **Informe de feedback con evidencia literal:** cada punto cita un fragmento de la transcripción; sin puntuaciones sin cita. Distingue «no observado» de «malo» (un hueco no es un cero).
5. **Privacidad y control:**
   - Consentimiento **propio y revocable** para grabar audio/transcribir, separado del consentimiento base y del de autorrelleno; fechado y versionado.
   - Retención definida y borrado por la alumna; el audio no se guarda salvo decisión expresa posterior.
   - **Ningún dato de alumnas a un LLM sin acuerdo de tratamiento y retención cero** (AGENTS.md). El escenario del roleplay no necesita su perfil completo.
   - Clonado de voz (p. ej. Chatterbox) solo con consentimiento explícito de la persona clonada; la voz del «cliente» usa voces genéricas.
   - Claves solo en variables de entorno / pestaña cifrada; contenido de la alumna tratado como dato no confiable (inyección).

## Licencias revisadas (2026-10-17, leyendo el LICENSE del repo)
| Pieza | Licencia leída | Veredicto |
|---|---|---|
| Pipecat (`pipecat-ai/pipecat`) | BSD-2-Clause, © Daily | Admitida; candidato principal |
| LiveKit Agents (`livekit/agents`) | Apache-2.0 | Admitida; alternativa |
| Kokoro (`hexgrad/kokoro`, **código**) | Apache-2.0 | Código admitido. **Pesos del modelo y calidad en español: sin verificar** |
| Whisper (`openai/whisper`) | MIT, © OpenAI | Admitida (STT) |
| Chatterbox (`resemble-ai/chatterbox`) | MIT, © Resemble AI | Admitida, con la cautela de clonado de arriba |
| JobSpy (`speedyapply/JobSpy`) | MIT, © Cullen Watson | Admitida; solo referencia (ya se usa vía Apify) |
| JobSync (`Gsync/jobsync`) | MIT, © gsync | Admitida; solo referencia de UX |
| Piper actual (`OHF-Voice/piper1-gpl`) | **GPL-3.0** | **Descartada** (corrige la suposición de que era MIT) |
| AIHawk | AGPL (no releída hoy) | **Descartada**: AGPL, y contradice las reglas de no aplicar automáticamente |

**Sin verificar** (solo servían de referencia de flujo; confirmar el LICENSE antes de copiar nada): «Close Call» (coach de ventas por voz sobre Pipecat; no se localizó el repo), Voicr, MockMate, CodeGenius, Interviewer (IliaLarchenko, Apache-2.0 según metadatos de Hugging Face). Los modelos de voz tienen licencia aparte de su código: se comprueba por modelo.

## Condiciones para empezar a construir (no cumplidas)
- Spike en rama aparte: una conversación de prueba con un cliente simulado, midiendo latencia, coste por sesión y calidad en español; sin datos reales de alumnas.
- Acuerdo de tratamiento / retención cero con el proveedor de LLM y de voz, o modelos autoalojados, antes de usar audio de alumnas.
- Texto legal de consentimiento revisado por el dueño o su asesor.
- Evals del feedback con un conjunto etiquetado a mano antes de mostrarlo como evaluación.

## Consecuencias
Queda fijado el marco (licencias, privacidad, interfaces) para que el trabajo de voz no obligue a rehacer lo existente. No cambia ningún comportamiento actual. Si una licencia cambia o una pieza se descarta, se actualiza esta tabla con fecha.
