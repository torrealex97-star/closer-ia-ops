# Relevo activo

> **Lee esto primero** al retomar el trabajo, junto con `AGENTS.md`, `docs/STATUS.md` y el último commit de `main`.
> Documento corto a propósito (≤ ~150 líneas). Histórico → `docs/handoff/archive/`. Trabajos vivos → `docs/handoff/claims/` (`npm run handoff`). Reglas → `docs/handoff/README.md`.
> Última actualización: 2026-10-17.

## 1. Tablero (trabajos vivos)

Fuente: `node scripts/handoff.mjs list`. Hoy hay un solo agente (`claude-cloud`); no hay otros agentes con ficha. Nada `in_progress` ahora mismo.

| Rama | PR | Estado | Depende de |
| --- | --- | --- | --- |
| `feat/student-auth` (2.1 login de alumnas) | #5 | validated, espera revisión | — |
| `feat/student-matching` (3.1 recomendaciones) | #6 | validated, espera revisión | #5 |
| `docs/growth-ops-learnings` | #7 | validated, espera revisión | — |
| `docs/agents-handoff` (este relevo + reglas aprobadas en AGENTS.md) | #8 | validated, espera revisión | #7 |
| `docs/design-chart-skills` (skills de diseño y gráficas) | #10 | validated, espera revisión | #8 |
| `feat/cron-budget` (1.4 presupuesto de tiempo del cron) | #9 | validated, espera revisión | — (desde `main`) |

**Orden de fusión:** #5 → #6 (cambiar la base de #6 a `main` tras fusionar #5) · #7 → #8 (igual). Merge commit, no squash, para conservar la pila.

## 2. Estado de `main` (`00cc55b` + lo que se fusione)

- **Hecho y fusionado:** 1.1 revisor IA (shadow) · 0.2 métricas · 1.2 ingesta robusta · 1.3 niveles de fuentes + leads B2B + grants cerrados. Detalle: `docs/handoff/archive/2026-10.md`.
- **Hecho en BD real** (migraciones aplicadas, versionadas en `supabase/migrations/` solo desde la sesión 44): `revoke_public_grants_b2b_weekly`, `student_auth_foundation`. Las 9 migraciones anteriores siguen **sin versionar** (SQL no recuperable desde las herramientas; hace falta `supabase db pull`).
- **Evidencia vigente (vocabulario inspeccionado / probado / verificado):**
  - *Probado:* `tests/admin-auth/run.sh` (flujo 36/36 + interfaz 8/8, Supabase y motor **simulados**), pruebas unitarias del revisor, métricas, ingesta, niveles/B2B y matching.
  - *Verificado en BD real:* RLS de alumnas (`tests/db/student_rls.sql`, 12/12, con rollback) y grants.
  - *No probado en real:* Apify, Groq, InfoJobs/Adzuna/Jooble, Jev, correos y login contra Supabase Auth, cron en Vercel.
  - **Hueco de CI descubierto:** el workflow `Quality` NO ejecutaba `tests/admin-auth/run.sh`; solo corrían pytest/typecheck/build/e2e. Esta PR añade el job `web-admin`; **no verificado en CI hasta que corra**.

## 3. Tareas del dueño (lo que solo tú puedes hacer)

1. **Revisar y fusionar** #9 (independiente), #5 → #6 y #7 → #8 (yo no fusiono). Orden docs: #7 → #8 → #10. Tras #9, el cron declara `truncated`/`spent_ms`: vigílalo en los logs de Vercel la primera semana.
2. **Supabase → Authentication → URL Configuration:** permitir `https://app.womendigitalclosers.com/alumna/reset`. Activar *Leaked password protection*. Configurar SMTP propio.
3. **Incremento 0.1 (Apify):** Panel → Apify, `max_items=10`, y pasar ofertas, coste real, campos del actor y errores. Comparar con `harvestapi/linkedin-job-search` si se quiere LinkedIn barato.
4. **Pegar el tarball `closer-offers-engine`** y ejecutar `supabase db pull` (migraciones previas).
5. **Vercel:** `INGEST_TOKEN` (y en GitHub secrets), claves InfoJobs/Adzuna/Jooble en Panel → APIs; **redeploy tras cambiar variables**; pasar a **Pro** antes de abrir a alumnas.
6. **Revisor IA:** dejar 5-7 días en shadow y comparar con tus decisiones; el paso a `live` es tuyo. Conjunto dorado (~30 ofertas etiquetadas) antes de decidir.
7. **Legal:** revisar el texto de consentimiento (`v1-borrador`) y la política de privacidad antes de abrir a alumnas.
8. **Decidir `--muted`** (contraste 3,4:1, no cumple AA en texto pequeño): ¿lo sustituyo por `--secondary` en texto < 14 px? Ver `dashboard-design`.
9. **Activar el login para las alumnas** (decisión tuya, pendiente): hoy `/` sigue abierta sin login.

## 4. Decisiones pendientes

- Activar el login y proteger `/` (ver tarea 8).
- Qué otros agentes trabajarán aquí y su carril por defecto (hoy solo `claude-cloud`). Propuesta: un agente por carril — *captación/ingesta*, *alumnas/matching*, *infra/CI/BD*.
- Si se permite a un agente fusionar PRs propias con CI verde (hoy: no).

## 5. Siguiente acción exacta

1. *(1.4 hecha: PR #9.)* Con tu OK: 3.2 candidatura **asistida** (la alumna revisa y envía; claim atómico; nada automático).

## 6. No declarar PASS en

Apify, Groq, Jev, fuentes oficiales, correos y login reales, cron en Vercel, el job `web-admin` en CI, ni el revisor en `live`: siguen sin probarse en real.
