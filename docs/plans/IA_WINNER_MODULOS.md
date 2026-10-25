# IA Winner · Women Digital Closers — Módulos 1 a 5: diseño del dueño y estado real

> Fuente: diseño que aporta el dueño (2026-10-25). Este documento **no es una promesa de entrega**: cada fila dice si está **hecho**, **parcial**, **pendiente** o **bloqueado** y quién lo desbloquea. Lo que falte se anota aquí y en `docs/ACTIVE_HANDOFF.md`; nada se da por hecho sin una entrada en `docs/STATUS.md` con su evidencia (*inspected / tested / verified*).
> Reglas que mandan sobre este diseño: `AGENTS.md`, ADR-007 (Groq), ADR-012 (candidaturas asistidas), ADR-013 (voz), ADR-014 (métricas). Objetivo del programa (no una garantía que mostrar en la app): llevar a las closers de nivel cero a proyectos de alto ticket en 90 días.

Leyenda: ✅ hecho · 🟡 parcial · ⬜ pendiente · ⛔ bloqueado (necesita decisión, acuerdo o permiso del dueño)

## Módulo 1 — Roleplay de ventas por voz
| Pieza | Estado | Detalle / siguiente paso |
|---|---|---|
| Roleplay de venta por **texto** con nota 0-100 por ejes y citas | ✅ | `/alumna` → Sala de práctica (12 escenarios) |
| Dictado y lectura en voz alta en el navegador, orbe | 🟡 | Entrada y salida por voz del navegador; **sin** conversación manos libres ni barge-in |
| Panel previo: nicho → oferta → arquetipo | ⬜ | 5 nichos × 2-3 ofertas ficticias y 4 arquetipos (escéptico, analítico, impulsivo, indeciso). Hoy hay 4 perfiles de **entrevistador**, no de cliente |
| Conversación por voz continua con interrupción (barge-in) y tono variable | ⬜ | Primera versión con voz del navegador (sin coste ni proveedor); la versión < 500 ms exige servidor propio |
| **WebRTC bidireccional < 500 ms** (STT + LLM + TTS) | ⛔ | Necesita un worker fuera de Vercel (Pipecat, ADR-013), claves de proveedor de voz, y que se cumplan las condiciones del ADR-013 |
| Scorecard 0-100 con 5 criterios + guion de reescritura con citas literales | ⬜ | Rúbrica propia a alinear con la actual (ejes 0-100); sin cita no hay puntuación |
| Ingesta de llamadas externas (Fathom, Plaud, MP3/WAV) solo texto | ⛔ | Llamadas de terceros: consentimiento de todas las personas que hablan; ver «Legal» |
| Créditos de minutos de IA por alumna | ⛔ | Necesita sesión de alumna (login apagado) y tope de coste acordado |
| Peer-to-peer ilimitado entre alumnas | ⛔ | Sala WebRTC + consentimiento mutuo + reglas de convivencia |

## Módulo 2 — Entrevistas, optimización de perfil y formulario
| Pieza | Estado | Detalle / siguiente paso |
|---|---|---|
| Entrevistas por texto (4 entrevistadores, nota y citas) | 🟡 | Hay 3 escenarios y 4 «perfiles» de entrevistador por texto; faltan **HR y Director de Growth** alineados con el diseño |
| Entrevistas por voz | ⛔ | Igual que el Módulo 1 |
| Guion de videopresentación (gancho, métricas, propuesta, llamada a la acción) | ⬜ | **Versión determinista** (plantilla con los datos que ella ha rellenado, sin IA) construible ya |
| Redactor de CV orientado a ventas | ⬜ | Versión determinista (lista de lenguaje pasivo/genérico y términos de closer) construible ya |
| Asistente de formularios con IA que combina perfil + CV + método | ⛔ | **Regla de AGENTS.md / ADR-012**: no se envían datos de la alumna a un modelo sin acuerdo de tratamiento y retención cero |
| Control de intentos con créditos | ⛔ | Como arriba (login + tope) |

## Módulo 3 — Adquisición de ofertas, pipeline y auto-apply
| Pieza | Estado | Detalle / siguiente paso |
|---|---|---|
| Captación diaria multifuente | ✅/🟡 | Google Jobs (7 búsquedas), SerpApi de respaldo, InfoJobs/Adzuna/Jooble (**sin clave**), Apify (**sin resultados reales aún**) |
| Inventario y purga a 10 días, filtros por país/perfil | ✅ | Ventana de 10 días; tope de 60 al día |
| Filtros por nicho y por tipo de comisión | ⬜ | Requieren etiquetar nicho/comisión al clasificar |
| Pipeline de la alumna (borrador → abierta → enviada → respuesta → entrevista → oferta) | ✅/🟡 | Hecho en código (PR #35); los estados de respuesta necesitan aplicar la migración `application_outcomes` |
| «Preparar aplicación» con un clic | ✅ | Borrador determinista y datos para copiar (ADR-012) |
| Asistente de copy conectado a la oferta | ⛔ | Igual que Módulo 2 (datos de la alumna a un LLM) |
| **Auto-apply con Playwright/Camoufox y operadores** | ⛔ | **No se construye.** ADR-012 prohíbe automatizar sin autorización escrita y sin cumplir sus condiciones; Camoufox es un navegador anti-detección y saltarse captchas/antibots no se hará; un equipo ejecutando candidaturas por la alumna necesita su consentimiento expreso |
| **Email proxy** (alias por alumna, webhook, clasificación) | ⛔ | Proveedor: **Resend** (decisión del dueño). Diseñado en ADR-014; comprobar en la documentación de Resend que ofrece correo entrante con webhook firmado, precio, dominio y DNS; consentimiento propio. Clasificación **determinista** al principio (palabras clave) y con confirmación de la alumna |
| Offboarding por éxito (estado «Contratada», ranking) | ⬜ | Necesita estado nuevo (migración) y regla de cuándo se da por contratada |

## Módulo 4 — Dashboards, gamificación, gestión y créditos
Leyenda como arriba. Las métricas derivadas ya están definidas en [ADR-014](../decisions/ADR-014-metricas-alumnas-y-gamificacion.md).

| Pieza | Estado | Nota |
| --- | --- | --- |
| Panel de alumna (nivel, XP, racha, maestría, candidaturas) | ✅ | «Mi progreso». Los **pesos de XP y los nombres de nivel difieren de los de tu propuesta**: decídelo y se ajusta en un solo sitio (`studentMetrics.ts`). |
| Panel de coordinación (embudo, módulos, notas, empujones, retención, candidatas a derivar) | ✅ | Solo sugerencias; la derivación la decide una persona. |
| Insignias / ranking entre alumnas | 🟡/⬜ | Logros ya existen; ranking público necesita consentimiento y puede desmotivar: pendiente de tu decisión. |
| Alertas por inactividad (>5 días) | 🟡 | Se detecta («empujones»); **el envío automático por WhatsApp/correo está apagado** hasta orden expresa. |
| Ocultar ofertas a la alumna contratada mediante correo proxy | ⛔ | Necesita consentimiento y revisión legal; la contratación la confirma una persona. |
| Offboarding automático | ⛔ | Siempre con confirmación humana. |
| Créditos de IA y práctica entre compañeras | ⛔ | Requieren login de alumnas activo y, para lo segundo, moderación y consentimiento. |

## Módulo 5 — Seguridad, acreditación, cohortes y retención (spec del dueño, 2026-10-25)
| Pieza | Estado | Nota |
| --- | --- | --- |
| 1. Detector de ofertas peligrosas (reglas, puntuación 0-100, SAFE/WARNING/BLOCKED) | 🟡 en construcción | Reglas deterministas sobre texto; enganchado a `red_flags`/`judgeOffer`. **No incluye** verificar CIF, dominio <30 días ni LinkedIn (consultas externas): ⬜. |
| 2. Graduación con mentora humana y calibración | ⬜ | Diseño en ADR; hace falta un conjunto de calibración etiquetado por tus mentoras. |
| 2. Webhook de certificados | ⛔ | Apagado hasta tener URL y token de tu app de certificados; un certificado «oficial» necesita revisión legal. |
| 3. Correo entrante (Resend) y clasificación | ⛔ | Comprobar en la documentación de Resend que ofrece recepción con webhook. La IA solo **propondría** la fase; `CONTRATADA` solo con confirmación humana. |
| 3. Atribución por cohorte y recalibrar recomendaciones | ⬜ | Necesita contrataciones reales y consentimiento. |
| 4. Avisos a los 2 y 4 días sin practicar; vía rápida a mentora (<60 en 3 prácticas seguidas); objetivos semanales | 🟡/⬜ | El cálculo y el panel sí; envíos reales (WhatsApp/correo) apagados hasta orden expresa. «Práctica con una compañera» queda fuera. |
| 4. Retención cero con el proveedor de voz | ⛔ | Acuerdo tuyo con el proveedor (ADR-013). |

## Legal (necesario para todo lo anterior)
- Términos y condiciones, privacidad y consentimientos de audio/transcripción: **borrador** en la app; los revisa el dueño o su asesor antes de usar audio real de alumnas (ADR-013).
- Acuerdo de tratamiento y retención cero con los proveedores (LLM, voz, correo) o modelos autoalojados.
- Llamadas externas (Fathom/Plaud): consentimiento de los participantes.
- No mostrar «+2.000 €/mes en 90 días» como garantía.
