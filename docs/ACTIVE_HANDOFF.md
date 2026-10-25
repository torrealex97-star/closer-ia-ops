# Relevo activo

> **Lee esto primero** al retomar el trabajo, junto con `AGENTS.md`, `docs/STATUS.md` y el último commit de `main`.
> Documento corto a propósito (≤ ~150 líneas). Histórico → `docs/handoff/archive/`. Trabajos vivos → `docs/handoff/claims/` (`npm run handoff`). Reglas → `docs/handoff/README.md`.
> Última actualización: 2026-10-24 (tarde).

## 1. Tablero (trabajos vivos)

Fuente: `node scripts/handoff.mjs list`. **Trabajan todos los agentes** (Claude, Codex u otros): todos siguen este protocolo (ficha propia, `touches` sin solapes, una rama en curso cada uno). Hoy solo hay fichas de `claude-cloud`; los demás agentes aún no han registrado ninguna. Carriles por defecto propuestos (confirmar con el dueño): *captación/ingesta*, *alumnas/matching/candidaturas*, *infra/CI/BD*.

| Rama | PR | Estado |
| --- | --- | --- |
| _(ninguno: no hay trabajos vivos)_ | — | — |

Todo lo anterior (PRs #1-#27 y los commits directos de las sesiones 76-89) está fusionado en `main`. Al fusionar una PR, su ficha de `docs/handoff/claims/` se borra en la PR siguiente.

## 2. Estado de `main`

- **Fusionado hoy** (PRs #1-#18, con CI de GitHub en verde antes de cada fusión): revisor IA shadow, métricas, ingesta robusta, niveles de fuentes + leads B2B + grants, presupuesto de tiempo del cron, login de alumnas + perfil + RLS, recomendaciones, candidaturas asistidas, interruptor `STUDENT_LOGIN_REQUIRED`, informe de acuerdo IA/humano, baseline de esquema, ADR-013 (voz), contraste `--muted`, skills y relevo entre agentes. Detalle: `docs/handoff/archive/2026-10.md`.
- **Sesiones 76-89 (otra rama, ya en `main`, 2026-10-24):** formación (6 módulos + examen determinista), Google Jobs con 7 búsquedas, agrupación de republicaciones, modo degradado si el motor cae, gazetteer de 8.132 municipios (también en el worker, desplegado), cualificación automática (reglas; tope 100/día; mercado por moneda; migración `apply_url/company_url/contact/market_basis/auto_review` aplicada), respaldo SerpApi para portales sin API oficial (tope 4 búsquedas/día, ≈0,275 USD/día en el peor caso). Detalle: `docs/STATUS.md` sesiones 76-89.
- **Sesiones 90-94 (claude-cloud, PRs #29-#33, ya en `main`):** actividad y progreso de alumnas reconstruidos (API, panel «Mi progreso», columnas en el panel); Formación con «Los diez cierres» y «Los nueve pasos de descubrimiento» (7 módulos en el progreso); la sala de práctica registra nota y ejes; chequeo `tests/orphan-refs.mjs` (rutas y ficheros de prueba que no existen) dentro de `run.sh`; panel de coordinación en «Alumnas». **La migración `supabase/migrations/20261024_student_activity.sql` NO está aplicada** (orden del dueño): hasta entonces «Mi progreso» da un error honesto y el panel de admin muestra «—».
- **Carriles** (para no duplicar trabajo entre agentes): claude-cloud = alumnas, formación, progreso y paneles; captación/ingesta (Apify, Google Jobs, SerpApi) e infra/CI/BD quedan para otros agentes: cada uno sube su ficha antes de tocar código.
- **Pendiente de esa rama:** confirmar que el respaldo SerpApi (sesión 89) está desplegado; InfoJobs/Adzuna/Jooble sin clave (~767 anuncios fuera); Apify `aakash19/jobspy` devuelve 0 ítems (hay que mirar su dataset con la clave del panel); el motor repite tarjetas («Conquista Tu Maternidad» ×9); paso «Progreso» de `ui.mjs` inestable.
- **Migraciones aplicadas y versionadas** (`supabase/migrations/`): `revoke_public_grants_b2b_weekly`, `student_auth_foundation`. `student_application_profile` (3.2). Las 9 tablas previas siguen sin migraciones originales: hay un snapshot de referencia en `supabase/schema/` (hace falta `supabase db pull` para lo definitivo).
- **Evidencia (inspeccionado / probado / verificado):**
  - *Verificado en GitHub:* el workflow `Quality` (jobs `verify` y `web-admin`) pasa en verde en las PRs #5-#10.
  - *Verificado en BD real:* RLS de alumnas (`tests/db/student_rls.sql`, 12/12 con rollback) y grants.
  - *Probado (servicios simulados):* panel, ingesta, revisor, alumnas, matching, presupuesto del cron.
  - *No probado en real:* Apify, Groq, InfoJobs/Adzuna/Jooble, Jev, correos y login contra Supabase Auth, el cron en Vercel.

## 3. Tareas del dueño (lo que solo tú puedes hacer)

1. **Supabase → Authentication:** URL Configuration → permitir `https://app.womendigitalclosers.com/alumna/reset`; activar *Leaked password protection*; SMTP propio.
2. **Incremento 0.1 (Apify):** Panel → Apify, `max_items=10`; pasar ofertas, coste real, campos del actor y errores. Opcional: comparar con `harvestapi/linkedin-job-search`.
3. **Pegar el tarball `closer-offers-engine`** y ejecutar `supabase db pull`.
4. **Vercel:** `INGEST_TOKEN` (y en GitHub secrets); claves InfoJobs/Adzuna/Jooble en Panel → APIs; **redeploy tras cambiar variables**; pasar a **Pro** antes de abrir a alumnas. Primera semana: mirar `truncated`/`spent_ms` del cron en los logs.
5. **Revisor IA:** 5-7 días en shadow comparando con tus decisiones; el paso a `live` es tuyo.
6. **Legal:** el agente redactó un borrador (`/privacidad` + textos de consentimiento `v2-borrador` + `docs/legal/PRIVACIDAD_Y_CONSENTIMIENTOS.md`). Te toca: rellenar en Vercel `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_TAX_ID`, `LEGAL_ENTITY_ADDRESS`, `LEGAL_PRIVACY_EMAIL` (+ redeploy) y pasarlo a un profesional (RGPD/LOPDGDD) con la lista de puntos abiertos.
7. **Activar el login para las alumnas** (decisión tuya): ya existe el interruptor `STUDENT_LOGIN_REQUIRED=true` en Vercel (+ redeploy); apagado = `/` abierta. Antes: invitar a las alumnas y probar el correo real.
8. **Revisor IA → live:** confirmar o ajustar la puerta propuesta (≥ 30 pares comparados y ≤ 5 % de falsas aprobaciones; informe en Fuentes externas).
9. **Voz (futuro):** antes de construir roleplays/entrevistas, acuerdo de tratamiento o retención cero con el proveedor (o modelos autoalojados) y texto legal del consentimiento de audio (ADR-013).

## 4. Decisiones ya tomadas

- Los vídeos NO se guardan: cada alumna guarda el suyo en su Drive y solo se guarda el enlace.
- 3.2 candidaturas: **asistidas** ahora (ella revisa y envía); el diseño deja preparada la automatización futura (ver ADR-012) sin activarla.
- Skills de marketing importadas (para cuando haga falta).
- Candidaturas: formulario base con consentimiento de autorrelleno futuro aparte (ADR-012).
- Futuro: roleplays de ventas por voz y simulaciones de entrevista con personalidades de IA; solo licencias MIT/Apache/BSD; base y privacidad en ADR-013 (nada implementado).
- **Fusión de PRs: autorización PERMANENTE** (dueño, 2026-10-18): los agentes fusionan sus PRs con CI verde, sin conflictos y con merge commit. Siguen exigiendo orden expresa: DDL/secretos reales, activar login de alumnas o revisor IA en `live`, automatización de candidaturas, gasto de pago nuevo (ver `AGENTS.md`).
- **Spike de voz autorizado** (dueño, 2026-10-18), acotado: sin audio real ni datos de alumnas (ADR-013).

## 5. Siguiente acción exacta

1. Candidatos para el siguiente incremento (agente): menú del panel en móvil y lista de Fuentes paginada en móvil; métricas sin ceros falsos (coste Apify ilegible, decisiones fuera de ventana); guarda SSRF con IP fijada contra DNS rebinding; spike acotado de voz (Pipecat) cuando el dueño lo autorice.
2. Con datos reales: calibrar matching y revisar el revisor IA con el informe de acuerdo.
3. Fase 4 (automatización) NO empieza sin autorización escrita: ver ADR-012.

## 7. Módulos IA Winner (voz, entrevistas, adquisición): qué falta

Diseño y estado de cada pieza, en [docs/plans/IA_WINNER_MODULOS.md](plans/IA_WINNER_MODULOS.md) (✅ hecho · 🟡 parcial · ⬜ pendiente · ⛔ bloqueado). **Lo que figura como pendiente o bloqueado NO está hecho**, aunque se hable de ello. Decisiones del dueño (2026-10-25): construir los módulos de voz y sus páginas legales; correo entrante con **Resend**; candidaturas **asistidas** (el auto-apply masivo con Playwright/Camoufox y operadores queda fuera hasta autorización escrita, ADR-012).

## 6. No declarar PASS en

Apify, Groq, Jev, fuentes oficiales, correos y login reales, cron en Vercel, ni el revisor en `live`.
