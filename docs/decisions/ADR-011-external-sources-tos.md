# ADR-011 — Fuentes externas: APIs con clave y scraping asumido por el operador

Fecha: 2026-10-16. Estado: aceptada por el operador (Alex Torre, propietario).

## Contexto
El motor cloud solo recoge fuentes públicas verificadas y no alcanza el volumen objetivo (20 ofertas de closer en España visibles). La sesión 25 había descartado LinkedIn por sus condiciones de uso.

## Decisión
1. **APIs con permiso del proveedor primero**: InfoJobs, Adzuna y Jooble, con claves guardadas cifradas en el panel (pestaña APIs). Recogida diaria (Vercel Cron, 06:00 UTC) y botón «Recoger APIs ahora».
2. **JobSpy (MIT) para Indeed, LinkedIn y Google Jobs**, ejecutado en GitHub Actions (`.github/workflows/jobspy-collect.yml`). El operador **asume expresamente el riesgo** de que estas webs prohíban el scraping en sus condiciones de uso (bloqueos, requerimientos). Se mitiga: volumen bajo (7 consultas × 20 resultados por sitio y día, pausa de 10 s), sin datos de contacto (se descartan correos de JobSpy y se limpian correos/teléfonos del texto), enlace siempre al anuncio original y desactivable (borrar el workflow o los secretos).
3. **Nada es visible sin revisión humana**: todo entra como `draft` en `public.external_offers` (Supabase, RLS sin políticas, solo service role); la alumna ve una oferta externa solo si un operador la aprueba y además cumple perfil (título), España (señal explícita), antigüedad ≤ 10 días y español.
4. **Evidencia**: el `raw` guardado es una lista blanca mínima y no se sobrescribe al volver a ver la oferta (`external_upsert`); el estado editorial tampoco.

## Consecuencias
- Un segundo catálogo (Postgres) convive con el motor D1; la vista de alumna los fusiona en el proxy. A futuro puede unificarse al migrar el motor.
- Las fuentes externas dependen de claves y secretos que solo el operador puede crear (InfoJobs/Adzuna/Jooble, `INGEST_TOKEN`, secretos de GitHub).

## Adenda 2026-10-16: Apify y escala
- El operador no tiene ni va a crear infraestructura de proxies. Para el volumen (miles de ofertas) se añade la ejecución de **actores de Apify** (su infraestructura y proxies), de pago por uso: desactivados por defecto, con tope mensual propio, límites por ejecución, una ejecución a la vez por actor y webhook firmado con HMAC. El actor `aakash19/jobspy` es un envoltorio de comunidad: se muestra como preajuste con la advertencia de comprobar su ficha.
- Ranking y huella al entrar (`lib/offerScore.ts`, columnas `score`, `role`, `spain`, `fingerprint`) para filtrar y deduplicar en el servidor; la aprobación sigue siendo humana (en bloque, por filtros).
