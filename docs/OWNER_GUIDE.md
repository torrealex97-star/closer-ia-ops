# Guía paso a paso: lo que solo puedes hacer tú

Escrita el 2026-10-26. Cada bloque dice qué consigues, cuánto tarda y los pasos. Los nombres de menús de Supabase, GitHub, Vercel, Cloudflare y Resend **pueden haber cambiado**: si un botón no está donde digo, busca el nombre entre comillas. Marcado ⚠️ lo que no he podido comprobar.

Orden recomendado: 1 → 3 (GitHub, 15 min) · 4 → 5 (Supabase, 20 min) · 6 (D1, 5 min) · 7 → 8 (correo y variables, 35 min) · el resto cuando toque.

---

## 1. Proteger el repositorio público (GitHub) · 10 min
1. Entra en `github.com/torrealex97-star/closer-ia-ops` → **Settings** → **Code security** (a veces «Advanced Security»).
2. Activa **Secret scanning** y, justo debajo, **Push protection** (bloquea un `git push` que lleve una clave).
3. Activa **Private vulnerability reporting** (para que te avisen en privado, como dice `SECURITY.md`).
4. Recomendable: **Dependabot alerts** y **Dependabot security updates**.
5. Revisión extra del historial en tu ordenador (con Docker): `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --log-opts="--all"`. Si sale un hallazgo real: **rota esa clave** en su proveedor (borrarla del repositorio no basta).

## 2. Licencia · 3 min · decisión tuya
Sin `LICENSE` el código es «todos los derechos reservados»: nadie puede reutilizarlo, aunque sea público. Si quieres que sea así, no hagas nada. Si quieres abrirlo: GitHub → **Add file → Create new file** → nombre `LICENSE` → botón **Choose a license template** (MIT es la más permisiva) → commit. O dime cuál prefieres y la añado yo.

## 3. Borrar las ramas ya fusionadas · 5 min
1. GitHub → **Settings → General** → bloque «Pull Requests» → marca **Automatically delete head branches** (así no se acumulan más).
2. Para borrar las que ya hay: en tu ordenador con el repo clonado, pega esto. Son **49 ramas totalmente fusionadas en `main`**: su contenido sigue en `main` y cualquiera se puede restaurar desde su PR con «Restore branch».
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
   (Yo lo intenté y mi entorno bloquea borrar ramas remotas; por eso lo haces tú. Dejé fuera las 6 del otro agente con menos de 12 h: `feat/cola-contador`, `feat/cola-excepciones-real`, `feat/ext-abre-excepciones`, `feat/ext-fuentes-donde-hay-trabajo`, `feat/motor-clasifica-solo`, `docs/produccion-verificada`.)
3. **No borres a ciegas** `feat/formacion-progreso` ni `claude/cloud-student-view`: son versiones antiguas divergentes. `feat/formacion-progreso` guarda `tests/db/test_student_activity.sql` y `tests/browser/progress.spec.ts`; si no los quieres, bórralas: `git push origin --delete feat/formacion-progreso claude/cloud-student-view`.

## 4. Ejecutar las pruebas de BD con escrituras · 10 min
Qué consigues: confirmar con la base real que las restricciones y la RLS se comportan (todo se deshace solo).
1. Supabase → tu proyecto → **SQL Editor** → **New query**.
2. Abre en GitHub `tests/db/student_activity.sql`, copia **todo**, pégalo y pulsa **Run**. Debe terminar con un error que empieza por `ACTIVIDAD_OK:` (a propósito: así se deshace todo). Un error que empiece por `FALLO` significa que algo no se cumple: pégamelo.
3. Repite con `tests/db/application_outcomes.sql` (debe acabar en `RESULTADOS_OK:`).
4. `tests/db/voice_consent.sql` usa `begin … rollback`: pégalo entero; no debe dar error.
5. Opcional: **Advisors** (menú izquierdo) → *Security* y *Performance*.

## 5. Supabase Authentication · 10 min
1. **Authentication → URL Configuration**: en **Redirect URLs** añade `https://app.womendigitalclosers.com/alumna/reset`. «Site URL» = `https://app.womendigitalclosers.com`.
2. **Authentication → Sign In / Providers → Email** (o «Password security»): activa **Leaked password protection**. ⚠️ Puede requerir el plan Pro de Supabase; si no aparece, es eso.
3. **Project Settings → Authentication → SMTP Settings**: «Enable custom SMTP» con los datos de tu proveedor de correo. Con Resend: host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = tu API key, remitente de tu dominio verificado. ⚠️ Estos datos SMTP son de memoria: confírmalos en la documentación de Resend.
4. Prueba: invita a una alumna de prueba desde el panel y comprueba que le llega el correo.

## 6. Cuota de escrituras de D1 (Cloudflare) · 5 min
Iba en 94.177 de 100.000 al mes, se reinicia el 1 de noviembre y la clasificación diaria añade unas 400 al día. Si se agota, el motor deja de escribir hasta el reinicio (no se rompe nada más).
1. dash.cloudflare.com → **Workers & Pages → D1** → la base del motor → **Metrics** → «Rows written».
2. Si quieres margen: **Workers & Pages → Plans** → plan de pago de Workers. ⚠️ Comprueba el precio y que D1 sube sus límites con él.
3. Si no haces nada, con ~400 al día alcanza hasta el 1 de noviembre.

## 7. Resend (correo) · 20 min
1. Abre `resend.com/pricing`: gratuito = 3.000 correos/mes y 100/día; lo recibido cuenta igual que lo enviado (según su documentación). ⚠️ Confirma las cifras vigentes.
2. **Domains → Add Domain**: `careers.womendigitalclosers.com` (o el subdominio que decidas). Resend te da registros DNS (SPF, DKIM y MX para recibir): añádelos en tu proveedor de DNS y pulsa **Verify** (minutos u horas).
3. **API Keys → Create API Key**: permiso «Sending access» para empezar; cópiala (solo se muestra una vez).
4. En la app: **Panel → APIs → Resend → pegar la clave → Guardar → Comprobar**. Debe decir «Clave válida». (Hoy no envía nada.)
5. Dime cuando el dominio esté verificado y construyo el correo entrante (webhook `email.received`).

## 8. Variables de entorno de Vercel · 15 min
1. vercel.com → proyecto **closer-ia-ops** → **Settings → Environment Variables**.
2. Comprueba que existen (nombres exactos): `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (o `SUPABASE_SERVICE_ROLE_KEY`), `SUPABASE_PUBLISHABLE_KEY`, `ADMIN_SECRETS_KEY`, `ADMIN_PUBLIC_URL`, `INGEST_TOKEN`, `CRON_SECRET`, `CAREER_ENGINE_URL`, `GROQ_API_KEY`.
3. Añade los datos legales (para `/privacidad` y `/terminos`): `LEGAL_ENTITY_NAME` (razón social), `LEGAL_ENTITY_TAX_ID` (NIF/CIF), `LEGAL_ENTITY_ADDRESS`, `LEGAL_PRIVACY_EMAIL`.
4. **No actives todavía**: `STUDENT_LOGIN_REQUIRED`, `VOICE_ROLEPLAY` ni `AI_REVIEW_MODE=live`. Están apagadas a propósito.
5. Tras cambiar variables: **Deployments → ⋯ en el último → Redeploy** (sin redeploy no aplican).
6. Antes de abrir a alumnas: **Settings → Billing** → plan **Pro**.

## 9. Revisión legal · 1 reunión
1. Reúne `/privacidad` y `/terminos` (en producción tras el paso 8), `docs/legal/PRIVACIDAD_Y_CONSENTIMIENTOS.md` (puntos abiertos para el asesor) y `docs/decisions/ADR-013` y `ADR-015` (voz).
2. Pide a un profesional en RGPD/LOPDGDD que revise: base legal, encargados (Supabase, Vercel, Groq, Resend), plazos, derechos, el texto de consentimiento de audio y los términos (ley aplicable, responsabilidad, consumidoras).
3. Con su visto bueno me pasas los cambios y subo las versiones (`POLICY_VERSION`, `TERMS_VERSION`, `CONSENT_VERSION`); las alumnas con consentimiento anterior deberán aceptar de nuevo.

## 10. Groq y el proveedor de voz: retención cero · 30 min
Hoy el texto de la sala de práctica se envía a Groq (consta en `/privacidad`).
1. En tu cuenta de Groq busca los ajustes de datos/privacidad («Data controls», «Zero data retention») y sus condiciones («DPA»). ⚠️ No sé cómo lo ofrece Groq; si no lo ves, escríbeles pidiendo (a) un acuerdo de tratamiento (DPA) y (b) retención cero para tu organización.
2. Guarda su respuesta; sin ella no conviene abrir la sala a muchas alumnas ni activar la voz.
3. Para la voz: elige proveedor de STT/TTS, pídele lo mismo y dime cuál para ajustar el ADR-015.

## 11. Certificados y acreditación · cuando quieras
1. Pásame la **URL** de la API de tu app de certificados y un ejemplo de lo que acepta. El **token** no lo pegues en el chat: lo guardamos cifrado en Panel → APIs.
2. Etiquetado: 2-3 mentoras puntúan 20-30 prácticas o llamadas (buena/regular/mala + una frase de por qué). Con eso se calibra la nota antes de llamarla «evaluación».
3. Decide con tu asesor si puede llamarse «certificado oficial» o «de aprovechamiento».

## 12. Pruebas reales con proveedores · 20 min
- **Apify**: Panel → Apify → pega el token → «Probar con 10 ofertas» (`max_items=10`). Pásame cuántas ofertas salen, el coste y los errores.
- **InfoJobs**: developer.infojobs.net → crea una app (necesita aprobación) → `client_id:client_secret` en Panel → APIs → InfoJobs.
- **Adzuna**: developer.adzuna.com → regístrate → `app_id:app_key` en Panel → APIs → Adzuna.
- **Jooble**: es.jooble.org/api/about → clave de España (la de jooble.org solo trae ofertas de EE. UU.) en Panel → APIs → Jooble.
- Tras guardar cada clave: «Comprobar».

## 13. Activaciones (cuando tú decidas)
- **Login obligatorio para alumnas**: antes, invita a 2-3 alumnas de prueba y comprueba el correo real. Luego `STUDENT_LOGIN_REQUIRED=true` + redeploy. Apagar = quitar la variable.
- **Revisor IA en vivo**: 5-7 días en «shadow» y mira el informe de acuerdo en Fuentes externas. Con ≥ 30 pares comparados y ≤ 5 % de falsas aprobaciones, `AI_REVIEW_MODE=live` + redeploy.
- **Voz**: falta el texto legal, el proveedor y la pantalla de consentimiento (me lo pides y lo construyo) → después `VOICE_ROLEPLAY=on`.
- **Avisos por WhatsApp/correo**: ordénamelo expresamente, con la cuenta (WhatsApp Business o Resend verificado).
- **Candidaturas automáticas**: requieren autorización escrita (ADR-012); no se construye Camoufox.

## 14. Motor y esquema · 15 min
- **`closer-offers-engine` + `supabase db pull`**: pega el tarball del motor (o dime dónde) y, en tu ordenador con la CLI de Supabase: `supabase login`, `supabase link --project-ref jzchuizybyubtkownhlw`, `supabase db pull`. Sube el fichero que genera, así quedan versionadas las 9 tablas anteriores.

## 15. Decisiones de producto (respóndeme en el chat)
1. **XP y niveles**: ¿mantengo mis pesos y los 8 niveles, o usas los de tu propuesta? (se cambia en un solo fichero).
2. **Ranking entre alumnas**: ¿sí, no, o solo opt-in y agregado? (por defecto, no).
3. **«Contratada»**: ¿cuándo se da por contratada una alumna? (propuesta: ella lo declara y una mentora lo confirma con un clic).
4. **Copiloto «Jarvis»** con memoria: ¿lo quieres? Implica proveedor, presupuesto por alumna y decisión de coste.
5. **Ofertas con aviso del detector**: ¿se ocultan a las alumnas o solo se marcan en la revisión?
