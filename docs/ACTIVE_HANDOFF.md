# Relevo activo

> **Lee esto primero** al retomar el trabajo, junto con `AGENTS.md`, `docs/STATUS.md` y el último commit de `main`.
> Documento corto a propósito (≤ ~150 líneas). Histórico → `docs/handoff/archive/`. Trabajos vivos → `docs/handoff/claims/` (`npm run handoff`). Reglas → `docs/handoff/README.md`. Diseño y estado pieza a pieza de los módulos IA Winner → [docs/plans/IA_WINNER_MODULOS.md](plans/IA_WINNER_MODULOS.md).
> Última actualización: 2026-10-25.

Leyenda: ✅ hecho y probado · 🟡 parcial · ⬜ pendiente (construible) · ⛔ bloqueado por el dueño o por una decisión. **Lo pendiente o bloqueado NO está hecho.**

## 1. Tablero (trabajos vivos)

Fuente: `node scripts/handoff.mjs list`. **Trabajan todos los agentes** (Claude, Codex u otros): ficha propia, `touches` sin solapes, un trabajo en curso cada uno. Carriles propuestos (confirmar con el dueño): *captación/ingesta*, *alumnas/matching/candidaturas*, *infra/CI/BD*. claude-cloud = alumnas, formación, progreso, seguridad de ofertas y paneles.

Al escribir esto, abiertas: **#39** reglas de retención (cálculo y panel) y **#40** clave de Resend en Panel → APIs. Al fusionar una PR, su ficha se borra en la PR siguiente.

## 2. Estado de `main`

- **Hecho en sesiones 76-101** (detalle en `docs/STATUS.md`): formación (7 módulos + examen determinista, cierres y descubrimiento), progreso de alumnas (actividad, XP y niveles derivados, maestría, embudo de candidaturas con resultado), panel de coordinación, cualificación automática por reglas (tope 100/día), Google Jobs + SerpApi, términos y privacidad en borrador, **detector de ofertas peligrosas** (reglas; una oferta con señales nunca se aprueba sola).
- **Migraciones aplicadas en Supabase real**: `student_auth_foundation`, `student_application_profile`, `student_activity`, `auto_qualify_offers` y **`application_outcomes`** (aplicada y verificada el 2026-10-25: el `CHECK` de estado ya admite `responded/interview/offer/rejected`). Los asesores de seguridad solo avisan de lo esperado (tablas solo para la clave de servicio, sin políticas) y de la protección de contraseñas filtradas (tarea 1).
- **Escritas y NO aplicadas**: `20261026_integration_resend.sql` (ampliar el `CHECK` de proveedores; en #40). Hasta aplicarla, guardar la clave de Resend falla con un mensaje claro.
- **Evidencia**: *verificado en GitHub* (`verify` y `web-admin` en verde antes de cada fusión) · *verificado en BD real* (RLS de alumnas, estructura de `student_activity`, `CHECK` de candidaturas) · *probado con servicios simulados* (panel, ingesta, revisor, alumnas, matching, retención, detector) · *no probado en real*: Apify, Groq, InfoJobs/Adzuna/Jooble, Jev, Resend, correo y login contra Supabase Auth, cron en Vercel, WhatsApp.

## 3. Tareas del dueño (lo que solo tú puedes hacer)

1. **Supabase → Authentication**: permitir `https://app.womendigitalclosers.com/alumna/reset`; activar *Leaked password protection*; SMTP propio. **Aplicar `20261026_integration_resend.sql`** (o dar la orden) para poder guardar la clave de Resend.
2. **Muestra de ofertas reales** (o permiso para tomarla del inventario) para calibrar el detector de ofertas peligrosas: hoy sus reglas están sin calibrar.
3. **Resend**: comprobar en su documentación si ofrece recepción de correo con webhook y su precio; verificar el dominio; pegar la clave en Panel → APIs. Sin esto no se construye el correo entrante.
4. **Acreditación**: URL y token de tu app de certificados; mentoras que etiqueten un conjunto de calibración (llamadas buenas/malas); revisión legal de llamarlo «certificado oficial».
5. **Voz y datos**: acuerdo de tratamiento / retención cero con **Groq** (hoy el texto de la sala de práctica ya va a Groq) y con el proveedor de voz que elijas; WhatsApp Business si quieres avisos por ahí.
6. **Legal**: `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_TAX_ID`, `LEGAL_ENTITY_ADDRESS`, `LEGAL_PRIVACY_EMAIL` en Vercel (+ redeploy) y pasar `/privacidad` y `/terminos` (borradores) a un profesional (puntos en `docs/legal/PRIVACIDAD_Y_CONSENTIMIENTOS.md`).
7. **Decisiones de producto**: pesos de XP y nombres de niveles (los míos difieren de tu propuesta, un solo sitio: `studentMetrics.ts`); ranking público entre alumnas (consentimiento; puede desmotivar); cuándo se da una alumna por «contratada» (siempre con confirmación humana).
8. **Pruebas reales pendientes**: Apify (Panel → Apify, `max_items=10`, pasar ofertas y coste); claves InfoJobs/Adzuna/Jooble en Panel → APIs; redeploy tras cambiar variables; **Vercel Pro** antes de abrir a alumnas; `INGEST_TOKEN`.
9. **Activaciones (tuyas, nunca mías)**: `STUDENT_LOGIN_REQUIRED=true`; revisor IA a `live` tras 5-7 días en shadow (puerta propuesta: ≥ 30 pares y ≤ 5 % de falsas aprobaciones); cualquier envío automático (WhatsApp/correo) y la fase 4 de candidaturas (ADR-012, autorización escrita).
10. Pegar el tarball `closer-offers-engine` y ejecutar `supabase db pull` (las 9 tablas previas no tienen migraciones originales).

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
| 1 | Banderas de riesgo visibles en la revisión de ofertas | ⬜ | Mostrar nivel y códigos de `offerRisk.ts` en `ExternalTab`. Agente. |
| 2 | **Voz** (orden del dueño): consentimiento de audio + interruptor `VOICE_ROLEPLAY` apagado, catálogo (5 nichos × 2-3 ofertas ficticias, 4 arquetipos de cliente, 4 entrevistadores), rúbrica de 5 criterios con citas literales, bucle manos libres en el navegador, ADR-015 (WebRTC < 500 ms, Pipecat) y su sección en `/privacidad` y `/terminos` | ⬜ | Agente (migración de consentimiento escrita, aplicarla es tuya). Audio real con alumnas: ⛔ hasta tarea 5. |
| 3 | Revisión directa de mentora como petición guardada (botón) | ⬜ | Tabla nueva (migración). Hoy es solo un aviso. |
| 4 | Detector: CIF, dominio < 30 días, LinkedIn; calibración con ofertas reales | ⛔ | Tarea 2; consultas externas. |
| 5 | Graduación con mentora humana + conjunto de calibración + webhook de certificados | ⛔ | Tareas 4. Webhook apagado hasta tener URL/token. |
| 6 | Correo entrante (Resend) + clasificación propuesta por IA + «CONTRATADA» con 1 clic humano + atribución por cohorte | ⛔ | Tarea 3 y consentimiento; la IA solo propone. |
| 7 | Etiquetado de nicho/comisión/ticket y filtros; detector de ofertas ya publicadas | ⬜ | Agente. |
| 8 | Perfil de alumna compartible con consentimiento (para empresas) | ⬜/⛔ | Consentimiento y revisión legal. |
| 9 | Créditos de IA por alumna y práctica entre compañeras | ⛔ | Login de alumnas activo; moderación y consentimiento. |
| 10 | Avisos reales por WhatsApp/correo (los cálculos ya existen en #39) | ⛔ | Tarea 9 (orden expresa) + cuenta. |
| 11 | Auto-apply con Playwright/Camoufox y operadores | ⛔ | **No se construye** (ADR-012). |

Otros candidatos del agente: guarda SSRF con IP fijada contra DNS rebinding; métricas sin ceros falsos (coste Apify ilegible); el motor repite tarjetas («Conquista Tu Maternidad» ×9); Apify `aakash19/jobspy` devuelve 0 ítems (mirar su dataset con la clave del panel); confirmar el despliegue del respaldo SerpApi.

## 6. No declarar PASS en

Apify, Groq, Jev, fuentes oficiales, Resend, correos y login reales, cron en Vercel, WhatsApp, el revisor en `live`, ni la calibración del detector de ofertas.
