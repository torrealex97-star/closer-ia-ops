# ADR-015 — Voz en la sala de práctica: interruptor, consentimiento y arquitectura (diseño; nada de audio activo)

Estado: propuesta · Fecha: 2026-10-26 · Evidencia: *inspeccionado* (código y ADR-013 leídos); no se ha ejecutado nada de voz ni se ha medido latencia.

## Contexto
El dueño ordenó construir los módulos de voz (roleplay de ventas y simulaciones de entrevista, con conversación continua). [ADR-013](ADR-013-voice-roleplay-foundations.md) fijó licencias y privacidad pero dejó condiciones **sin cumplir** para usar audio de alumnas: acuerdo de tratamiento o retención cero con el proveedor, texto legal revisado y evals con conjunto etiquetado. Hoy la sala funciona por **texto**, con dictado y lectura en voz alta del navegador (`useVoiceInput.ts`); el audio de la alumna **no** pasa por nuestros servidores.

## Decisión
1. **Interruptor del propietario, apagado por defecto.** `VOICE_ROLEPLAY=on` en Vercel (+ redeploy) es lo único que puede abrir la voz continua. Sin él, la API de voz responde «no activa» y la interfaz no ofrece nada. Activarlo es decisión del dueño y exige las condiciones de ADR-013.
2. **Consentimiento propio, revocable y versionado**, separado del consentimiento del perfil y del de autorrelleno. Tabla `student_voice_consent` (una fila por alumna: versión del texto, fecha de aceptación, fecha de revocación). Migración escrita **sin aplicar** (`20261027_voice_consent.sql`); aplicarla es decisión del dueño. Sin consentimiento vigente no se abre ninguna sesión de voz, aunque el interruptor esté encendido.
3. **Dos fases de producto:**
   - **Fase A — navegador, manos libres.** Sigue usando el reconocimiento y la síntesis del navegador, con turnos automáticos e interrupción (*barge-in*) del cliente simulado. El audio no llega a nuestros servidores; **según el navegador, el dictado puede ir a su proveedor** (en Chrome, a Google): la privacidad lo dice. No mide tono ni ritmo: la rúbrica de voz marca esos criterios como «no observado», nunca como «malo».
   - **Fase B — canal en tiempo real (WebRTC, objetivo < 500 ms de ida y vuelta).** Orquestación candidata Pipecat (BSD-2-Clause) en un worker aparte (no en Vercel), STT y TTS detrás de `VoiceProvider`, LLM detrás de `LLMProvider`. Solo con **retención cero** firmada: el audio se procesa en memoria y se descarta al sacar la transcripción; no se guarda audio. Spike acotado antes (latencia, coste por sesión y calidad en español con voluntarias que consientan), sin datos reales de alumnas.
4. **Misma rúbrica y mismo catálogo que el texto.** Las 19 situaciones de la sala valen para voz; la nota por criterios con **cita literal** de la transcripción es la misma que en texto. Un criterio sin evidencia es «no observado». Los criterios propios de la voz (tono, ritmo, muletillas) solo se puntúan en Fase B y con evals.
5. **Calibrar antes de presentarlo como evaluación.** Hasta tener un conjunto etiquetado por las mentoras, las notas se rotulan «estimación del modelo», como ahora.
6. **Topes de coste y abuso.** Minutos por alumna y por día, y tope global, aplicados en servidor (dependen del login de alumnas activo); una sesión se corta y lo dice cuando llega al tope.
7. **Claves** solo en variables de entorno o en la pestaña cifrada de APIs; el contenido de la alumna es dato no confiable (inyección).

## Qué se construye ahora (esta PR)
`lib/voice.ts` (interruptor y estado de consentimiento, probados), `GET /api/student/voice` (siempre «no activa» sin interruptor), la migración de consentimiento sin aplicar y su prueba de BD sin ejecutar. **No hay audio, ni proveedor, ni cambios visibles para las alumnas.**

## Lo que NO se hace (y por qué)
- Grabar o guardar audio de alumnas: no se guarda, ni en Fase A ni en Fase B.
- Abrir la voz continua sin interruptor, consentimiento vigente y acuerdo con el proveedor.
- Prometer notas de tono o ritmo en el navegador.
- Clonar voces: las del «cliente» son genéricas.

## Pendiente del dueño
Acuerdo de tratamiento / retención cero con el proveedor de voz y con Groq; revisión legal del texto de consentimiento de audio; elegir proveedor de STT/TTS y asumir su coste; aplicar la migración; decidir cuándo encender `VOICE_ROLEPLAY`.

## Consecuencias
La voz queda diseñada de punta a punta y con los candados puestos antes del código que la mueve. No cambia ningún comportamiento actual de la sala.
