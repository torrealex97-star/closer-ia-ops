# Spike de voz — cómo ejecutarlo con proveedores reales (lo hace el dueño)

Estado: **solo simuladores probados.** Latencia, coste por sesión y calidad en español reales: **no medidos** (este entorno no tiene claves de STT/LLM/TTS ni se usan datos de alumnas). Decisiones y privacidad: `docs/decisions/ADR-013-voice-roleplay-foundations.md`.

## Qué hay
- `providers.mjs`: firmas `LLMProvider` y `VoiceProvider` + simuladores. Los reales se enchufan con las mismas firmas.
- `personalities/*.json`: personalidades versionadas (cliente escéptico, entrevistador). Cambiar de personalidad = cambiar un fichero.
- `session.mjs`: sesión por texto con tope de coste (turnos y caracteres) y fallos declarados.
- `feedback.mjs`: informe con citas literales; «no observado» ≠ «malo»; sin puntuaciones.
- Prueba: `node spikes/voice/tests/voice.mjs` (sin red).

## Verificado en este entorno
`pip download --no-deps pipecat-ai` → **pipecat-ai 1.12.0**, `License-Expression: BSD-2-Clause`, Python ≥ 3.11 (metadato del paquete). No se instaló ni se ejecutó.

## Para medir con Pipecat y claves reales (en TU máquina o entorno aislado)
1. Entorno aparte (no `apps/web`): `python3.11 -m venv .venv-voice && .venv-voice/bin/pip install pipecat-ai` (+ los extras del STT/TTS que elijas; **comprueba la licencia de cada modelo por separado**, ADR-013).
2. Claves SOLO en variables de entorno (nunca en el repo ni en logs). Tope de coste por sesión ≤ 0,50 USD y sin guardar audio.
3. Pipeline: micrófono → STT (p. ej. Whisper, MIT) → LLM (Groq, ADR-007) con el `system` de la personalidad → TTS (p. ej. Kokoro, Apache-2.0, **verificar pesos y español**) → altavoz. La transcripción resultante se pasa a `buildFeedback`.
4. **No uses datos reales de alumnas** ni audio de terceros; usa tu voz o guiones inventados. El consentimiento de audio de alumnas sigue pendiente de texto legal.

## Qué medir y pegarme
| Medida | Cómo | Resultado |
| --- | --- | --- |
| Latencia fin de frase → primera palabra del cliente | cronómetro o logs de Pipecat, 10 turnos | ___ s (media / p95) |
| Coste por sesión de 10 min | panel de cada proveedor | ___ USD |
| Calidad de voz en español (1-5, 3 oyentes) | escucha a ciegas | ___ |
| ¿El cliente mantiene la personalidad 10 turnos? | sí / a veces / no | ___ |
| ¿El informe cita solo lo dicho? | revisar 3 informes | ___ |
| Errores / cortes | notas | ___ |

Con esos datos se decide proveedor y se escribe el siguiente incremento (nada de esto se despliega aún).
