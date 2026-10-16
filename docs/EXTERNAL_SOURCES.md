# Fuentes externas: puesta en marcha

Qué hace cada pieza y qué tiene que hacer el operador. Contexto y riesgos: [ADR-011](decisions/ADR-011-external-sources-tos.md).

## 1. APIs oficiales (InfoJobs, Adzuna, Jooble)
Se recogen solas cada día a las 06:00 UTC y desde el botón «Recoger APIs ahora» (Panel → Fuentes externas).
1. **InfoJobs**: cuenta de desarrollador en developer.infojobs.net → crear aplicación → `client_id` y `client_secret`. En Panel → APIs pega `client_id:client_secret`.
2. **Adzuna**: developer.adzuna.com → `app_id` y `app_key`. Pega `app_id:app_key`. (No se ha podido comprobar desde el entorno de desarrollo que Adzuna cubra España: si «Probar» o la recogida devuelven error, es esto.)
3. **Jooble**: jooble.org/api/about → clave. Pégala tal cual.
4. Pulsa «Probar» en cada una (no gasta crédito) y luego «Recoger APIs ahora».

## 2. JobSpy (Indeed, LinkedIn, Google Jobs) en GitHub Actions
1. Genera un token: `openssl rand -hex 32`.
2. Vercel → proyecto → Settings → Environment Variables: `INGEST_TOKEN` = ese token (Production).
3. GitHub → repo → Settings → Secrets and variables → Actions: `INGEST_TOKEN` = el mismo token e `INGEST_URL` = `https://app.womendigitalclosers.com/api/ingest`.
4. Actions → «JobSpy collect» → Run workflow (o espera a las 05:17 UTC). Las ofertas aparecen como borradores en Panel → Fuentes externas.
Los runners de GitHub a veces son bloqueados por LinkedIn/Indeed: un fallo aparece en el log del workflow y en el aviso de la entrada, y no afecta al resto.

## 3. Variables de entorno (Vercel, producción)
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` o `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (integración de Supabase), `CAREER_ENGINE_URL`, `CAREER_ADMIN_TOKEN`, `CRON_SECRET` (autoriza el cron), `INGEST_TOKEN` (autoriza el recolector de GitHub), opcional `ADMIN_SECRETS_KEY`.

## 4. Control diario
- **Pausar/reanudar** una fuente: Panel → Fuentes externas → tabla de fuentes (solo propietario). Pausada = no se recoge, no se acepta y no se muestra.
- **Vigencia**: cada día el cron revisa las aprobadas y retira las cerradas en origen. LinkedIn/Indeed suelen bloquear la comprobación («no verificable»): esas se mantienen.
- **Exportar**: botón «Exportar CSV» en Probar ofertas y en Fuentes externas.
