# Relevo activo

> **Lee esto primero** al retomar el trabajo, junto con `AGENTS.md`, `docs/STATUS.md` y el último commit de `main`.
> Documento corto a propósito (≤ ~150 líneas). Histórico → `docs/handoff/archive/`. Trabajos vivos → `docs/handoff/claims/` (`npm run handoff`). Reglas → `docs/handoff/README.md`.
> Última actualización: 2026-10-17.

## 1. Tablero (trabajos vivos)

Fuente: `node scripts/handoff.mjs list`. **Trabajan todos los agentes** (Claude, Codex u otros): todos siguen este protocolo (ficha propia, `touches` sin solapes, una rama en curso cada uno). Hoy solo hay fichas de `claude-cloud`; los demás agentes aún no han registrado ninguna. Carriles por defecto propuestos (confirmar con el dueño): *captación/ingesta*, *alumnas/matching/candidaturas*, *infra/CI/BD*.

| Rama | PR | Estado |
| --- | --- | --- |
| `fix/review-hardening` (correcciones de la revisión de código) | #19 | validated |

Todo lo anterior (PRs #1-#18) está fusionado en `main`. Al fusionar una PR, su ficha de `docs/handoff/claims/` se borra en la PR siguiente.

## 2. Estado de `main`

- **Fusionado hoy** (PRs #1-#18, con CI de GitHub en verde antes de cada fusión): revisor IA shadow, métricas, ingesta robusta, niveles de fuentes + leads B2B + grants, presupuesto de tiempo del cron, login de alumnas + perfil + RLS, recomendaciones, candidaturas asistidas, interruptor `STUDENT_LOGIN_REQUIRED`, informe de acuerdo IA/humano, baseline de esquema, ADR-013 (voz), contraste `--muted`, skills y relevo entre agentes. Detalle: `docs/handoff/archive/2026-10.md`.
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
6. **Legal:** revisar el texto de consentimiento (`v1-borrador`) y la política de privacidad antes de abrir a alumnas.
7. **Activar el login para las alumnas** (decisión tuya): ya existe el interruptor `STUDENT_LOGIN_REQUIRED=true` en Vercel (+ redeploy); apagado = `/` abierta. Antes: invitar a las alumnas y probar el correo real.
8. **Revisor IA → live:** confirmar o ajustar la puerta propuesta (≥ 30 pares comparados y ≤ 5 % de falsas aprobaciones; informe en Fuentes externas).
9. **Voz (futuro):** antes de construir roleplays/entrevistas, acuerdo de tratamiento o retención cero con el proveedor (o modelos autoalojados) y texto legal del consentimiento de audio (ADR-013).

## 4. Decisiones ya tomadas

- Los vídeos NO se guardan: cada alumna guarda el suyo en su Drive y solo se guarda el enlace.
- 3.2 candidaturas: **asistidas** ahora (ella revisa y envía); el diseño deja preparada la automatización futura (ver ADR-012) sin activarla.
- Skills de marketing importadas (para cuando haga falta).
- Candidaturas: formulario base con consentimiento de autorrelleno futuro aparte (ADR-012).
- Futuro: roleplays de ventas por voz y simulaciones de entrevista con personalidades de IA; solo licencias MIT/Apache/BSD; base y privacidad en ADR-013 (nada implementado).
- Fusión de PRs: el dueño autoriza fusionar las que estén listas (CI verde) en cada petición; no es permiso permanente.

## 5. Siguiente acción exacta

1. Fusionar #19 (CI verde). Después, candidatos para el siguiente incremento (agente): menú del panel en móvil y lista de Fuentes paginada en móvil; métricas sin ceros falsos (coste Apify ilegible, decisiones fuera de ventana); guarda SSRF con IP fijada contra DNS rebinding; spike acotado de voz (Pipecat) cuando el dueño lo autorice.
2. Con datos reales: calibrar matching y revisar el revisor IA con el informe de acuerdo.
3. Fase 4 (automatización) NO empieza sin autorización escrita: ver ADR-012.

## 6. No declarar PASS en

Apify, Groq, Jev, fuentes oficiales, correos y login reales, cron en Vercel, ni el revisor en `live`.
