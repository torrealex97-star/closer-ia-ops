# Relevo activo

> **Lee esto primero** al retomar el trabajo, junto con `AGENTS.md`, `docs/STATUS.md` y el último commit de `main`.
> Documento corto a propósito (≤ ~150 líneas). Histórico → `docs/handoff/archive/`. Trabajos vivos → `docs/handoff/claims/` (`npm run handoff`). Reglas → `docs/handoff/README.md`. Diseño y estado pieza a pieza de los módulos IA Winner → [docs/plans/IA_WINNER_MODULOS.md](plans/IA_WINNER_MODULOS.md).
> Última actualización: 2026-10-25.

Leyenda: ✅ hecho y probado · 🟡 parcial · ⬜ pendiente (construible) · ⛔ bloqueado por el dueño o por una decisión. **Lo pendiente o bloqueado NO está hecho.**

## 1. Tablero (trabajos vivos)

Fuente: `node scripts/handoff.mjs list`. **Trabajan todos los agentes** (Claude, Codex u otros): ficha propia, `touches` sin solapes, un trabajo en curso cada uno. Carriles propuestos (confirmar con el dueño): *captación/ingesta*, *alumnas/matching/candidaturas*, *infra/CI/BD*. claude-cloud = alumnas, formación, progreso, seguridad de ofertas y paneles.

Fusionadas en `main`: #47 etiquetas de nicho y pago, #46 bases de la voz, #38 detector de ofertas, #39 retención, #40 clave de Resend, #41 relevo, #42 banderas de riesgo en la revisión, #43 catálogo de la sala (19 situaciones). Al fusionar una PR, su ficha se borra en la PR siguiente.

**Otros agentes y ramas (revisado el 2026-10-26):** otro agente (firma «Codebuff», autor Alex Torre) fusionó **#45**: el motor retira con motivo lo que su puerta determinista descarta, el cron clasifica el pool y el panel tiene el botón «Clasificar y publicar solas»; la cola abre en las excepciones (detalle en `docs/STATUS.md`, sesión 107). Dejó además `docs/PORTING_REVIEW.md` (qué más se puede traer de las apps anteriores; de ahí salen las fases 12-15). Siguen **sin fusionar** dos ramas antiguas que **no se deben fusionar tal cual**: `feat/formacion-progreso` (versión anterior y divergente del progreso y de la clasificación, que `main` ya tiene reconstruidos; conserva `tests/db/test_student_activity.sql` y `tests/browser/progress.spec.ts`, por si se quiere rescatar alguno) y `claude/cloud-student-view` (12-oct, casi todo superado). Las ramas ya fusionadas (`feat/*`, `docs/*`) siguen existiendo: ver tarea 11.

## 2. Estado de `main`

- **Hecho en sesiones 76-113** (detalle en `docs/STATUS.md`): formación (7 módulos + examen determinista, cierres y descubrimiento), progreso de alumnas (actividad, XP y niveles derivados, maestría, embudo de candidaturas con resultado), panel de coordinación, cualificación automática por reglas (tope 100/día), Google Jobs + SerpApi, términos y privacidad en borrador, **detector de ofertas peligrosas** (reglas; una oferta con señales nunca se aprueba sola, y la revisión muestra el nivel y el motivo), reglas de retención como cálculo y panel (sin envíos), clave de Resend guardable en Panel → APIs, sala de práctica con 19 situaciones (5 ofertas ficticias por nicho y entrevistadores de RR. HH. y dirección de ventas).
- **Migraciones aplicadas en Supabase real**: `student_auth_foundation`, `student_application_profile`, `student_activity`, `auto_qualify_offers` y **`application_outcomes`** (aplicada y verificada el 2026-10-25: el `CHECK` de estado ya admite `responded/interview/offer/rejected`). Los asesores de seguridad solo avisan de lo esperado (tablas solo para la clave de servicio, sin políticas) y de la protección de contraseñas filtradas (tarea 1).
- **Aplicadas el 2026-10-26 por orden del dueño y verificadas leyendo la base**: `20261026_integration_resend` (ya se puede guardar la clave de Resend), `20261027_voice_consent` (tabla vacía con RLS; la voz sigue apagada) y `20261028_voice_consent_student_index`. **Sin ejecutar**: las pruebas de BD con escrituras (`tests/db/*.sql`), porque Supabase pide la confirmación del dueño (tarea 13).
- **Evidencia**: *verificado en GitHub* (`verify` y `web-admin` en verde antes de cada fusión) · *verificado en BD real* (RLS de alumnas, estructura de `student_activity`, `CHECK` de candidaturas) · *probado con servicios simulados* (panel, ingesta, revisor, alumnas, matching, retención, detector) · *no probado en real*: Apify, Groq, InfoJobs/Adzuna/Jooble, Jev, Resend, correo y login contra Supabase Auth, cron en Vercel, WhatsApp.

## 3. Tareas del dueño (lo que solo tú puedes hacer)

> **Paso a paso detallado de cada una: [docs/OWNER_GUIDE.md](OWNER_GUIDE.md)** (pasos de GitHub, Supabase, Cloudflare, Resend, Vercel, legal, Groq, certificados y activaciones).

1. **Supabase → Authentication**: permitir `https://app.womendigitalclosers.com/alumna/reset`; activar *Leaked password protection*; SMTP propio. (Migraciones de Resend y de consentimiento de voz: ya aplicadas.)
2. **Ofertas peligrosas reales**: lo contrasté con las 204 vigentes del inventario (0 críticas, 5 avisos: 100 % comisión y «libertad financiera»; sesión 109). Lo que falta es una colección de **estafas reales** que hayas visto (textos) para saber si las detecta; sin ellas sigue sin poder presumirse eficaz. Revisa a mano las empresas con aviso (Bastida&Farina, NAOLEAD, Monest Capital).
3. **Resend**: ya consta (por búsqueda, sin abrir su web) que **sí hay correo entrante con webhook `email.received`** y que lo recibido cuenta en la misma cuota (gratis: 3.000/mes y 100/día; ver ADR-014). Te toca: abrir resend.com/pricing y comprobar el precio vigente, verificar el dominio y pegar la clave en Panel → APIs (ya se puede guardar). Después se construye el correo entrante.
4. **Acreditación**: URL y token de tu app de certificados; mentoras que etiqueten un conjunto de calibración (llamadas buenas/malas); revisión legal de llamarlo «certificado oficial».
5. **Voz y datos**: acuerdo de tratamiento / retención cero con **Groq** (hoy el texto de la sala de práctica ya va a Groq) y con el proveedor de voz que elijas; WhatsApp Business si quieres avisos por ahí.
6. **Legal**: `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_TAX_ID`, `LEGAL_ENTITY_ADDRESS`, `LEGAL_PRIVACY_EMAIL` en Vercel (+ redeploy) y pasar `/privacidad` y `/terminos` (borradores) a un profesional (puntos en `docs/legal/PRIVACIDAD_Y_CONSENTIMIENTOS.md`).
7. **Decisiones de producto**: pesos de XP y nombres de niveles (los míos difieren de tu propuesta, un solo sitio: `studentMetrics.ts`); ranking público entre alumnas (consentimiento; puede desmotivar); cuándo se da una alumna por «contratada» (siempre con confirmación humana).
8. **Pruebas reales pendientes**: Apify (Panel → Apify, `max_items=10`, pasar ofertas y coste); claves InfoJobs/Adzuna/Jooble en Panel → APIs; redeploy tras cambiar variables; **Vercel Pro** antes de abrir a alumnas; `INGEST_TOKEN`.
9. **Activaciones (tuyas, nunca mías)**: `STUDENT_LOGIN_REQUIRED=true`; revisor IA a `live` tras 5-7 días en shadow (puerta propuesta: ≥ 30 pares y ≤ 5 % de falsas aprobaciones); cualquier envío automático (WhatsApp/correo) y la fase 4 de candidaturas (ADR-012, autorización escrita).
10. Pegar el tarball `closer-offers-engine` y ejecutar `supabase db pull` (las 9 tablas previas no tienen migraciones originales).
11. **Repositorio público y ramas**: activar *Secret scanning* y *Push protection* (Settings → Code security). Revisé por patrones los 283 commits de todas las ramas sin hallar claves (sesión 109), pero pasa también gitleaks/trufflehog; decidir si añades `LICENSE` (hoy no hay: nadie puede reutilizar el código); activar *Automatically delete head branches* y borrar las ramas ya fusionadas; decidir qué hacer con `feat/formacion-progreso` y `claude/cloud-student-view` (ver arriba; no las borro yo).
12. **Cuota de escrituras de D1 del motor** (aviso del otro agente): iba en 94.177 / 100.000 con reinicio el **1 de noviembre**, y la pasada diaria de clasificación añade ~400 escrituras al día. Vigílala en Cloudflare; si se agota, el motor deja de escribir hasta el reinicio (decide si pasas a plan de pago).
13. **Ejecutar las pruebas de BD con escrituras** (`tests/db/*.sql`: `student_activity`, `application_outcomes`, `voice_consent` tras aplicarla) con *execute_sql*: Supabase pide tu confirmación y yo no puedo darla.
14. **Revisión profunda (sesión 116) — tuyo**: (a) *Groq → límite de gasto mensual* (el tope diario de la sala es por instancia, no un techo real); (b) borrar las 2 ramas antiguas: `git push origin --delete feat/formacion-progreso claude/cloud-student-view`; (c) decidir si el examen debe calificarse en servidor antes de llamarlo certificación; (d) `STUDENT_LOGIN_REQUIRED` solo protege el proxy de Vercel, no el Worker del motor (`/api/offers`).

## 4. Decisiones ya tomadas

- Los vídeos NO se guardan: cada alumna guarda el suyo en su Drive y solo se guarda el enlace.
- Candidaturas **asistidas** (ella revisa y envía); automatizar exige autorización escrita (ADR-012). **No se usa Camoufox** (anti-detección) ni operadores humanos de envío.
- Correo: proveedor **Resend** (decisión del dueño), solo diseño en ADR-014 hasta verificar sus capacidades.
- Métricas de alumnas derivadas, sin tabla que inflar (ADR-014). «+2.000 €/mes en 90 días» **no** se muestra como garantía.
- **Fusión de PRs: autorización PERMANENTE** (2026-10-18): los agentes fusionan sus PRs con `verify` y `web-admin` en verde, sin conflictos y con merge commit. Siguen exigiendo orden expresa: DDL/secretos reales, login de alumnas o revisor IA en `live`, automatización de candidaturas, gasto de pago nuevo (ver `AGENTS.md`).
- Spike de voz autorizado (2026-10-18), acotado: sin audio real ni datos de alumnas (ADR-013).

## 5. Próximas fases (sin hacer; orden sugerido)

| # | Fase | Estado | Qué falta / quién |
| --- | --- | --- | --- |
| 1 | Banderas de riesgo visibles en la revisión de ofertas | ✅ | Hecho (#42). Falta calibrar con ofertas reales (tarea 2). |
| 2 | **Voz** (orden del dueño) | 🟡 | Hecho: catálogo de 19 situaciones (#43), ADR-015, interruptor `VOICE_ROLEPLAY` apagado y estado de consentimiento (#46). **Falta**: texto y pantalla de consentimiento de audio, bucle manos libres con *barge-in* en el navegador (Fase A), rúbrica de tono/ritmo solo en Fase B (WebRTC < 500 ms, Pipecat, retención cero), topes de minutos por alumna, y su sección en `/privacidad` y `/terminos`. Audio real con alumnas: ⛔ hasta tarea 5 y la migración de consentimiento. |
| 3 | Revisión directa de mentora como petición guardada (botón) | ⬜ | Tabla nueva (migración). Hoy es solo un aviso. |
| 4 | Detector: CIF, dominio < 30 días, LinkedIn; calibración con ofertas reales | ⛔ | Tarea 2; consultas externas. |
| 5 | Graduación con mentora humana + conjunto de calibración + webhook de certificados | ⛔ | Tareas 4. Webhook apagado hasta tener URL/token. |
| 6 | Correo entrante (Resend) + clasificación propuesta por IA + «CONTRATADA» con 1 clic humano + atribución por cohorte | ⛔ | Tarea 3 y consentimiento; la IA solo propone. |
| 7 | Etiquetado de nicho/comisión/ticket y filtros | 🟡 | Etiquetas de nicho y pago visibles en la revisión (hecho). Faltan **filtros** (columnas guardadas = migración) y el ticket. Agente. |
| 8 | Perfil de alumna compartible con consentimiento (para empresas) | ⬜/⛔ | Consentimiento y revisión legal. |
| 9 | Créditos de IA por alumna y práctica entre compañeras | ⛔ | Login de alumnas activo; moderación y consentimiento. |
| 10 | Avisos reales por WhatsApp/correo (los cálculos ya existen en #39) | ⛔ | Tarea 9 (orden expresa) + cuenta. |
| 11 | Auto-apply con Playwright/Camoufox y operadores | ⛔ | **No se construye** (ADR-012). |
| 12 | Capas de objeción con reglas de salto (circunstancias → terceros → el yo) en la sala | ⬜ | Agente (prompts y escenarios); `docs/PORTING_REVIEW.md` punto 1. |
| 13 | Banco de 10 preguntas de entrevista con intención, fórmula y banderas rojas (modo estudio sin IA) | ✅ | Hecho (módulo 9 de Formación). Conviene que una closer lea las fórmulas y ejemplos. |
| 14 | Retos asignados por la coordinadora y objetivo semanal elegido por la alumna | ⬜ | Tabla nueva (migración sin aplicar → tu orden); punto 7. Los objetivos fijos ya existen (#39). |
| 15 | Voz con interrupción (*barge-in*) y copiloto «Jarvis» con memoria | ⛔ | Voz: ver fila 2. Copiloto: proveedor, presupuesto por alumna y decisión de coste tuyos; punto 8-9. |
| ✅ | Señales de apertura sumisa y entusiasmo de más; feedback con tarea de 24 h (puntos 2 y 4) | ✅ | Hecho (#50). |

Otros candidatos del agente: guarda SSRF con IP fijada contra DNS rebinding; métricas sin ceros falsos (coste Apify ilegible); el motor repite tarjetas («Conquista Tu Maternidad» ×9); Apify `aakash19/jobspy` devuelve 0 ítems (mirar su dataset con la clave del panel); confirmar el despliegue del respaldo SerpApi.

## 6. No declarar PASS en

Apify, Groq, Jev, fuentes oficiales, Resend, correos y login reales, cron en Vercel, WhatsApp, el revisor en `live`, ni la calibración del detector de ofertas.
