# Guía paso a paso: lo que solo puedes hacer tú

Actualizada el 2026-10-26. Cada bloque trae: **qué consigues**, **herramientas**, **lo que necesitas a mano**, **enlaces**, **pasos** y, cuando te toca hablar con una persona o conmigo, un **prompt/mensaje listo para copiar y pegar**.

Los menús de terceros **cambian**: si un botón no está donde digo, búscalo por el nombre entre comillas. ⚠️ = no lo he podido comprobar. Los enlaces profundos de Supabase/Vercel usan tu proyecto (`jzchuizybyubtkownhlw`, `app-b1af/closer-ia-ops`); si alguno falla, entra por el menú.

## Resumen: qué, con qué y cuánto

| # | Tarea | Herramienta | Necesitas a mano | Tiempo |
| --- | --- | --- | --- | --- |
| 1 | Proteger el repo público | GitHub (web) + Docker (opcional) | Ser propietario del repo | 10 min |
| 2 | Licencia | GitHub (web) | Decidir cuál | 3 min |
| 3 | Borrar ramas viejas | Terminal con git | Repo clonado | 5 min |
| 4 | Pruebas de BD | Supabase SQL Editor | Cuenta Supabase | 10 min |
| 5 | Supabase Auth | Supabase (web) | Datos SMTP de Resend | 10 min |
| 6 | Cuota de D1 | Cloudflare (web) | Cuenta Cloudflare | 5 min |
| 7 | Resend | Resend (web) + tu DNS | Acceso al DNS del dominio | 20 min |
| 8 | Variables de Vercel | Vercel (web) | Datos legales de la entidad | 15 min |
| 9 | Revisión legal | Asesor RGPD (persona) | Prompt 1 + enlaces de abajo | 1 reunión |
| 10 | Groq / voz: retención cero | Groq console + correo | Prompt 2 | 30 min |
| 11 | Certificados y mentoras | Tu app de certificados + mentoras | Prompt 3 | cuando quieras |
| 12 | Proveedores de ofertas | Apify, InfoJobs, Adzuna, Jooble | Cuentas en cada uno | 20 min |
| 13 | Activaciones | Vercel + panel | Todo lo anterior hecho | variable |
| 14 | Motor y esquema | Supabase CLI | Tarball del motor | 15 min |
| 15 | Decisiones de producto | Este chat | Prompt 10 | 10 min |
| 16 | Avisos del motor (panel y correo) | SQL Editor + Panel → APIs + Vercel | Clave de Resend | 15 min |

Orden recomendado: 1 → 3 → 4 → 5 → 6 → 7 → 8 → resto.

---

## 1. Proteger el repositorio público · 10 min
**Herramientas**: GitHub web; opcional Docker Desktop (para gitleaks).
**Enlaces**: [repo](https://github.com/torrealex97-star/closer-ia-ops) · [Settings → Code security](https://github.com/torrealex97-star/closer-ia-ops/settings/security_analysis) · [Qué es Secret scanning](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning) · [Push protection](https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection) · [gitleaks](https://github.com/gitleaks/gitleaks) · [trufflehog](https://github.com/trufflesecurity/trufflehog)
**Pasos**
1. Abre *Settings → Code security* (enlace de arriba; a veces se llama «Advanced Security»).
2. Activa **Secret scanning** y, justo debajo, **Push protection** (bloquea un `git push` que lleve una clave).
3. Activa **Private vulnerability reporting** (para que te avisen en privado, como dice `SECURITY.md`) y **Dependabot alerts**.
4. Revisión del historial en tu ordenador: `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --log-opts="--all"`.
5. Si sale un hallazgo real: **rota esa clave en su proveedor** (borrarla del repositorio no basta) y pégame el hallazgo **sin la clave**.

## 2. Licencia · 3 min · decisión tuya
**Enlaces**: [elegir licencia](https://choosealicense.com/) · [licencias en GitHub](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributors/adding-a-license-to-a-repository)
Sin `LICENSE` el código es «todos los derechos reservados»: nadie puede reutilizarlo aunque sea público. Si quieres eso, no hagas nada. Si quieres abrirlo: *Add file → Create new file → LICENSE → Choose a license template* (MIT = la más permisiva), o dime «pon la licencia X».

## 3. Borrar las ramas ya fusionadas · 5 min
**Herramientas**: terminal con git y el repo clonado. **Enlaces**: [borrado automático de ramas](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches)
1. [Settings → General](https://github.com/torrealex97-star/closer-ia-ops/settings) → «Pull Requests» → marca **Automatically delete head branches**.
2. Pega esto en la terminal (ramas **totalmente fusionadas en `main`**: su contenido sigue en `main` y cualquiera se restaura desde su PR con «Restore branch»):
```
git push origin --delete \
  claude/admin-auth \
  docs/agent-merge-policy \
  docs/agents-handoff \
  docs/close-coordinator \
  docs/close-mobile-metrics-ssrf \
  docs/close-oct26 \
  docs/close-privacy \
  docs/close-review-hardening \
  docs/design-chart-skills \
  docs/growth-ops-learnings \
  docs/handoff-oct25 \
  docs/handoff-refresh \
  docs/housekeeping \
  docs/ia-winner-modulos \
  docs/orphan-guard \
  docs/owner-actions \
  docs/privacy-consent-draft \
  docs/schema-baseline \
  docs/voice-roleplay-foundations \
  feat/ai-agreement-report \
  feat/ai-review-shadow \
  feat/apify-simple \
  feat/coordinator-dashboard \
  feat/cron-budget \
  feat/ingest-robustness \
  feat/legal-terms \
  feat/metrics-panel-design \
  feat/mobile-metrics-ssrf \
  feat/offer-metrics \
  feat/offer-risk \
  feat/offer-tags \
  feat/practice-progress \
  feat/resend-key \
  feat/retention-rules \
  feat/risk-flags-ui \
  feat/signals-coaching \
  feat/source-tiers-b2b \
  feat/student-activity \
  feat/student-application \
  feat/student-auth \
  feat/student-login-flag \
  feat/student-matching \
  feat/student-metrics \
  feat/training-closes \
  feat/voice-catalog \
  feat/voice-foundations \
  fix/muted-contrast \
  fix/review-hardening \
  spike/voice-roleplay
```
   Dejé fuera las 6 del otro agente con menos de 12 h (`feat/cola-contador`, `feat/cola-excepciones-real`, `feat/ext-abre-excepciones`, `feat/ext-fuentes-donde-hay-trabajo`, `feat/motor-clasifica-solo`, `docs/produccion-verificada`). Mi entorno bloquea borrar ramas remotas, por eso lo haces tú.
3. **No borres a ciegas** `feat/formacion-progreso` ni `claude/cloud-student-view` (versiones antiguas divergentes; la primera guarda `tests/db/test_student_activity.sql` y `tests/browser/progress.spec.ts`). Si no los quieres: `git push origin --delete feat/formacion-progreso claude/cloud-student-view`.

## 4. Pruebas de BD con escrituras · 10 min
**Qué consigues**: confirmar con la base real que restricciones y RLS funcionan (todo se deshace solo).
**Herramientas**: Supabase SQL Editor. **Enlaces**: [SQL Editor](https://supabase.com/dashboard/project/jzchuizybyubtkownhlw/sql/new) · [Advisors](https://supabase.com/dashboard/project/jzchuizybyubtkownhlw/advisors/security) · ficheros: [student_activity.sql](https://github.com/torrealex97-star/closer-ia-ops/blob/main/tests/db/student_activity.sql), [application_outcomes.sql](https://github.com/torrealex97-star/closer-ia-ops/blob/main/tests/db/application_outcomes.sql), [voice_consent.sql](https://github.com/torrealex97-star/closer-ia-ops/blob/main/tests/db/voice_consent.sql), [integration_resend.sql](https://github.com/torrealex97-star/closer-ia-ops/blob/main/tests/db/integration_resend.sql), [engine_alerts.sql](https://github.com/torrealex97-star/closer-ia-ops/blob/main/tests/db/engine_alerts.sql)
1. Abre el SQL Editor → **New query**.
2. Abre cada fichero en GitHub (botón **Raw**), copia **todo**, pégalo y **Run**. Resultado esperado: `student_activity` acaba con error `ACTIVIDAD_OK:` y `application_outcomes` con `RESULTADOS_OK:` (a propósito, así se deshace todo); `voice_consent` e `integration_resend` no deben dar error. Un error que empiece por `FALLO` = algo no se cumple.
3. **Prompt 8** (abajo) si algo falla.

## 5. Supabase Authentication · 10 min
**Herramientas**: Supabase web. **Enlaces**: [URL Configuration](https://supabase.com/dashboard/project/jzchuizybyubtkownhlw/auth/url-configuration) ⚠️ · [SMTP propio](https://supabase.com/docs/guides/auth/auth-smtp) · [Contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security) · [SMTP de Resend](https://resend.com/docs/send-with-smtp)
1. **Authentication → URL Configuration**: «Site URL» = `https://app.womendigitalclosers.com`; en **Redirect URLs** añade `https://app.womendigitalclosers.com/alumna/reset`.
2. Activa **Leaked password protection** (en *Authentication → Sign In / Providers → Email* o «Password security»). ⚠️ Puede requerir plan Pro.
3. **Project Settings → Authentication → SMTP Settings** → «Enable custom SMTP». Con Resend: host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = tu API key, remitente de tu dominio verificado (haz antes el paso 7). ⚠️ Confirma estos datos en el enlace de Resend.
4. Prueba: invita a una alumna de prueba desde el panel y comprueba que llega el correo.

## 6. Cuota de escrituras de D1 (Cloudflare) · 5 min
**Qué pasa**: iba en 94.177 de 100.000 al mes, se reinicia el 1 de noviembre y la clasificación diaria añade ~400 al día. Si se agota, el motor deja de escribir hasta el reinicio (no se rompe nada más).
**Enlaces**: [Cloudflare](https://dash.cloudflare.com/) · [Precios de D1](https://developers.cloudflare.com/d1/platform/pricing/) · [Límites de D1](https://developers.cloudflare.com/d1/platform/limits/)
1. *Workers & Pages → D1* → la base del motor → **Metrics** → «Rows written».
2. Si quieres margen: plan de pago de Workers. ⚠️ Comprueba precio y que D1 sube sus límites con él (enlace de precios).
3. Si no haces nada, ~400/día alcanza hasta el 1 de noviembre.

## 7. Resend (correo) · 20 min
**Herramientas**: Resend web + el panel de DNS de tu dominio (Cloudflare, GoDaddy…). **Necesitas**: acceso al DNS de `womendigitalclosers.com`.
**Enlaces**: [Precios](https://resend.com/pricing) · [Dominios](https://resend.com/domains) · [API keys](https://resend.com/api-keys) · [Correo entrante](https://resend.com/docs/dashboard/receiving/introduction) · [Webhook email.received](https://resend.com/docs/webhooks/emails/received)
1. Mira el plan: gratis = 3.000 correos/mes y 100/día, y lo **recibido cuenta igual** que lo enviado (según su documentación). ⚠️ Confirma cifras vigentes.
2. **Domains → Add Domain**: `careers.womendigitalclosers.com` (o el subdominio que decidas). Copia los registros DNS (SPF, DKIM y MX para recibir) a tu proveedor de DNS y pulsa **Verify**.
3. **API Keys → Create API Key**: «Sending access» para empezar; cópiala (se muestra una vez).
4. En la app: **Panel → APIs → Resend → pegar → Guardar → Comprobar**. Esperado: «Clave válida» (o «Clave válida (permiso solo de envío)» si la creaste restringida; si dice «rechazada», dímelo).
5. Cuando el dominio esté verificado: **Prompt 4** (abajo) para que construya el correo entrante.

## 8. Variables de Vercel · 15 min
**Herramientas**: Vercel web. **Necesitas**: razón social, NIF/CIF, dirección y email de privacidad.
**Enlaces**: [Variables del proyecto](https://vercel.com/app-b1af/closer-ia-ops/settings/environment-variables) ⚠️ · [Docs de variables](https://vercel.com/docs/environment-variables) · [Redeploy](https://vercel.com/docs/deployments/managing-deployments#redeploy-a-project) · [Planes](https://vercel.com/pricing)
1. Comprueba que existen (nombres exactos): `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (o `SUPABASE_SERVICE_ROLE_KEY`), `SUPABASE_PUBLISHABLE_KEY`, `ADMIN_SECRETS_KEY`, `ADMIN_PUBLIC_URL`, `INGEST_TOKEN`, `CRON_SECRET`, `CAREER_ENGINE_URL`, `GROQ_API_KEY`.
2. Añade los datos legales: `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_TAX_ID`, `LEGAL_ENTITY_ADDRESS`, `LEGAL_PRIVACY_EMAIL`.
3. Si el cron queda corto (cortes seguidos en su respuesta): `CRON_BUDGET_MS=50000`.
4. **No actives todavía** `STUDENT_LOGIN_REQUIRED`, `VOICE_ROLEPLAY` ni `AI_REVIEW_MODE=live`.
5. **Deployments → ⋯ → Redeploy** (sin redeploy las variables no aplican). Antes de abrir a alumnas: plan **Pro**.

## 9. Revisión legal · 1 reunión
**Herramientas**: un asesor/abogado en protección de datos (RGPD/LOPDGDD). **Enlaces**: [AEPD](https://www.aepd.es/) · [Guía RGPD para responsables](https://www.aepd.es/guias) · tus páginas: [/privacidad](https://app.womendigitalclosers.com/privacidad), [/terminos](https://app.womendigitalclosers.com/terminos) · [puntos abiertos](https://github.com/torrealex97-star/closer-ia-ops/blob/main/docs/legal/PRIVACIDAD_Y_CONSENTIMIENTOS.md) · [ADR-013](https://github.com/torrealex97-star/closer-ia-ops/blob/main/docs/decisions/ADR-013-voice-roleplay-foundations.md) · [ADR-015](https://github.com/torrealex97-star/closer-ia-ops/blob/main/docs/decisions/ADR-015-voz-en-la-sala-de-practica.md)
1. Envíale el **Prompt 1**.
2. Con su visto bueno, me pasas los cambios (**Prompt 5**) y subo las versiones; las alumnas con consentimiento anterior deberán aceptar de nuevo.

## 10. Groq y el proveedor de voz: retención cero · 30 min
Hoy el texto de la sala de práctica se envía a Groq (consta en `/privacidad`).
**Enlaces**: [Consola de Groq](https://console.groq.com/) · [Política de privacidad de Groq](https://groq.com/privacy-policy) ⚠️ (busca allí «data retention», «DPA», «zero data retention»).
1. En tu cuenta busca ajustes de datos/privacidad y condiciones (DPA). Si no los ves, envía el **Prompt 2** al soporte de Groq (chat de la consola o el correo de contacto de su web ⚠️).
2. Guarda su respuesta; sin ella no conviene abrir la sala a muchas alumnas ni activar la voz.
3. Para la voz: elige proveedor de STT/TTS, pídele lo mismo y dime cuál (**Prompt 6**).

## 11. Certificados y acreditación · cuando quieras
**Necesitas**: URL de la API de tu app de certificados + ejemplo de lo que acepta; 2-3 mentoras. El **token no lo pegues en el chat**: va cifrado en Panel → APIs.
1. Manda a las mentoras el **Prompt 3** con 20-30 prácticas/llamadas para puntuar.
2. Decide con tu asesor si puede llamarse «certificado oficial» o «de aprovechamiento».
3. Cuando lo tengas: **Prompt 7**.

## 12. Proveedores de ofertas · 20 min
**Enlaces**: [Apify tokens](https://console.apify.com/account/integrations) · [InfoJobs developers](https://developer.infojobs.net/) · [Adzuna API](https://developer.adzuna.com/) · [Jooble API (España)](https://es.jooble.org/api/about)
- **Apify**: Panel → Apify → pega el token → «Probar con 10 ofertas». Pasa el resultado con el **Prompt 9**.
- **InfoJobs**: crea app (necesita aprobación) → `client_id:client_secret` → Panel → APIs → InfoJobs.
- **Adzuna**: regístrate → `app_id:app_key` → Panel → APIs → Adzuna.
- **Jooble**: clave de **España** (la de jooble.org solo trae EE. UU.) → Panel → APIs → Jooble.
- Tras cada clave: «Comprobar».

## 13. Activaciones (cuando tú decidas)
- **Login obligatorio**: invita a 2-3 alumnas de prueba, comprueba el correo real y pon `STUDENT_LOGIN_REQUIRED=true` + redeploy. Apagar = quitar la variable.
- **Revisor IA en vivo**: 5-7 días en «shadow», mira el informe de acuerdo en Fuentes externas. Con ≥ 30 pares y ≤ 5 % de falsas aprobaciones: `AI_REVIEW_MODE=live` + redeploy.
- **Voz**: tras el texto legal, el proveedor y la pantalla de consentimiento (**Prompt 6**) → `VOICE_ROLEPLAY=on`.
- **Avisos por WhatsApp/correo**: ordénamelo expresamente (**Prompt 11**).
- **Candidaturas automáticas**: requieren autorización escrita (ADR-012); no se construye Camoufox.

## 14. Motor y esquema · 15 min
**Herramientas**: Supabase CLI. **Enlaces**: [instalar la CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) · [`supabase db pull`](https://supabase.com/docs/reference/cli/supabase-db-pull)
1. `supabase login` → `supabase link --project-ref jzchuizybyubtkownhlw` → `supabase db pull`.
2. Sube el fichero generado (o pásamelo) y pega el tarball de `closer-offers-engine` donde te indique. Así quedan versionadas las 9 tablas anteriores.

## 15. Decisiones de producto
Respóndeme con el **Prompt 10** (pegado y rellenado).

## 16. Avisos del motor (panel y correo) · 15 min
**Qué consigues**: enterarte de que el motor se ha pausado por cuota o ha dejado de responder **sin abrir la pestaña Fuentes** (la banda de aviso sale en todas las pestañas) y, si guardas la clave de Resend, también **por correo**.
**Herramientas**: SQL Editor de Supabase + Panel → APIs + Variables de Vercel. **Enlaces**: [migración](https://github.com/torrealex97-star/closer-ia-ops/blob/main/supabase/migrations/20261029_engine_alerts.sql) · [prueba de BD](https://github.com/torrealex97-star/closer-ia-ops/blob/main/tests/db/engine_alerts.sql) · [ADR-016](https://github.com/torrealex97-star/closer-ia-ops/blob/main/docs/decisions/ADR-016-avisos-del-motor-por-correo.md)
1. **Aplica la migración** `20261029_engine_alerts.sql` en el SQL Editor (paso 4). Es lo que permite avisar **una sola vez por estado**: sin ella el panel sigue diciendo la causa y el estado real, pero **no envía correo** y lo explica en pantalla (sin registro el aviso se repetiría en cada comprobación).
2. Pasa la prueba `tests/db/engine_alerts.sql` (se deshace sola): esperado, ningún `FALLO`.
3. Guarda la **clave de Resend** en Panel → APIs (paso 7). El aviso va **solo al propietario** de la lista de usuarios del panel, nunca a alumnas.
4. **Remitente**: por defecto se usa `onboarding@resend.dev`, que Resend solo deja escribir al correo de tu propia cuenta de Resend. Cuando verifiques tu dominio (paso 7), añade en Vercel `RESEND_FROM=avisos@careers.womendigitalclosers.com` y haz redeploy.
5. **Pruébalo** en Panel: si el motor está mal verás la banda con «Comprobar ahora»; al pulsarlo se registra la comprobación y, si toca, sale el correo. La pantalla dice a quién se envió o por qué no.
6. **Frecuencia**: la comprobación va con la recogida diaria (06:00 UTC). Con **Vercel Pro** se puede pasar a cada hora: pídemelo y añado la entrada del cron (el plan gratuito solo admite crons diarios).

---

# Prompts y mensajes listos para pegar

**Prompt 1 — Para el asesor legal (email)**
> Asunto: Revisión RGPD/LOPDGDD de una plataforma de formación para closers (borradores)
> Hola [nombre]: estamos a punto de abrir a alumnas una plataforma web (app.womendigitalclosers.com) que ofrece formación en ventas, una sala de práctica con IA (el texto de las conversaciones se envía a Groq), seguimiento de su progreso y recomendación/asistencia de candidaturas a ofertas de trabajo. Tenemos borradores de política de privacidad (/privacidad), términos (/terminos) y textos de consentimiento. Necesito que revises: (1) base legal por finalidad; (2) encargados del tratamiento (Supabase, Vercel, Groq, Resend) y transferencias internacionales; (3) plazos de conservación y derechos; (4) el texto de consentimiento previsto para audio/voz (aún no activo, retención cero); (5) ley aplicable, límites de responsabilidad y régimen de consumidoras en los términos; (6) si llamar «certificado oficial» a la acreditación es posible. Adjunto el listado de puntos abiertos: https://github.com/torrealex97-star/closer-ia-ops/blob/main/docs/legal/PRIVACIDAD_Y_CONSENTIMIENTOS.md. ¿Presupuesto y plazo?

**Prompt 2 — Para el soporte de Groq**
> Subject: DPA and zero data retention request
> Hello, we use the Groq API (key under organization [nombre]) to run a sales-training chat for students in the EU/Spain. The text students type is personal data. Could you (1) share your Data Processing Addendum (DPA) with SCCs, (2) confirm how to enable zero data retention for our organization, and (3) list your sub-processors and data locations? We will not enable voice or open the service to many users until this is in place. Thanks.

**Prompt 3 — Instrucciones para las mentoras (etiquetado)**
> Os paso [20–30] prácticas/llamadas. Para cada una rellenad: ID · nota global (buena / regular / mala) · una frase de por qué · lo MEJOR que hizo la alumna (cita literal) · lo que MÁS le frenó (cita literal). No miréis la nota automática antes de puntuar. Con esto calibramos el sistema antes de llamarlo «evaluación».

**Prompt 4 — Para retomar el correo entrante (pégamelo a mí)**
> Resend ya está verificado: dominio [careers.womendigitalclosers.com], clave guardada en Panel → APIs. Construye el correo entrante: dirección por alumna, webhook `email.received` con firma verificada, sin guardar el cuerpo del correo, la IA solo PROPONE la fase (entrevista/rechazo/oferta) y «contratada» solo con confirmación humana. Lee ADR-014 y docs/ACTIVE_HANDOFF.md primero. Dime qué DDL necesitas antes de aplicarlo.

**Prompt 5 — Para aplicar los cambios del asesor**
> Mi asesor legal pide estos cambios en /privacidad y /terminos: [pega aquí]. Aplícalos, sube POLICY_VERSION/TERMS_VERSION/CONSENT_VERSION y avísame de qué alumnas tendrán que volver a aceptar.

**Prompt 6 — Para la voz**
> Tengo el acuerdo de retención cero con [proveedor] y el texto de consentimiento de audio revisado por mi asesor: [pega el texto]. Construye la pantalla de consentimiento (revocable, versionada) sobre student_voice_consent y el bucle manos libres con interrupción de la Fase A de ADR-015. No actives VOICE_ROLEPLAY.

**Prompt 7 — Para los certificados**
> La API de certificados es [URL]; acepta [ejemplo de JSON]. La autenticación es [Bearer/otra] y guardé el token en Panel → APIs como «[nombre]». Implementa la graduación con mentora humana (1 clic), el webhook apagado por defecto y el conjunto de calibración con las etiquetas de las mentoras [pega o adjunta].

**Prompt 8 — Si falla una prueba de BD**
> Ejecuté tests/db/[fichero].sql y salió: [pega el mensaje EXACTO del error]. Diagnostica y arregla (migración nueva si hace falta; no apliques DDL sin decírmelo).

**Prompt 9 — Resultado de Apify**
> Probé Apify con max_items=10. Salieron [n] ofertas, coste [x] USD, errores: [pega]. Evalúa la calidad (campos, duplicados, ofertas útiles) y dime si merece activarlo.

**Prompt 10 — Decisiones de producto**
> 1) XP y niveles: [mantén los míos / usa los de mi propuesta: pega]. 2) Ranking entre alumnas: [no / sí opt-in agregado]. 3) «Contratada»: [ella declara + mentora confirma / otra regla]. 4) Copiloto Jarvis: [sí con presupuesto X por alumna / no]. 5) Ofertas con aviso del detector: [ocultar / solo marcar].

**Prompt 11 — Para activar avisos reales**
> Autorizo por escrito los avisos automáticos a alumnas por [correo con Resend / WhatsApp con la cuenta X]: a los 2 y 4 días sin practicar y la vía rápida a mentora. Máximo [n] mensajes por alumna y semana, con baja fácil. Constrúyelo con registro de envíos y botón de apagado, y pruébalo primero con [2-3 alumnas de prueba].

**Prompt genérico para retomar cualquier cosa**
> Lee AGENTS.md, docs/ACTIVE_HANDOFF.md y docs/OWNER_GUIDE.md. He hecho: [lista de pasos de la guía]. Continúa con lo que eso desbloquea y dime qué sigue siendo mío.
