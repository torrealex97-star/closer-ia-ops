# HireLATAM

Revisado: 2026-09-22. Prioridad propuesta: P0. Estado: investigada; integración nueva no implementada ni canary de extracción realizado. Tipo: recruiting. source_code: hirelatam.

## Evidencia y acceso

Bolsa para profesionales residentes en LATAM y empleadores US; declara inglés y enlaza widget Recruiterflow. [Referencia primaria](https://hirelatam.com/jobs/).
Entrada: [HireLATAM](https://hirelatam.com/jobs/).

Ruta propuesta: Seguir enlace público Recruiterflow desde la página oficial; adapter por tenant y detalle. No suponer API privada accesible.
Lectura pública prioritaria, sin cuentas personales del operador. Una API key de aplicación/proveedor es distinta de una sesión personal. La candidatura de la alumna puede necesitar su propia cuenta externa. No hay Actor de Apify validado para esta ficha.

## Búsqueda y elegibilidad

Consultas iniciales: appointment setter; SDR; account executive; bilingual sales.
LATAM e inglés requeridos por el portal: no presentarlo apto para España o español exclusivo. Cliente final puede no estar identificado.

Por defecto connection_type=external_application; ser recruiter, comunidad o careers corporativa no acredita relación directa con WDC.

## Contrato y operación propuesta

Conservar source/provider/external_id/raw/source_url/canonical_url, título, empresa y recruiter separados, descripción, fecha original nullable, application_url/type, idioma requerido/preferido, allowed/excluded countries, timezone y autorización laboral explícita. No rellenar ausentes por contexto del portal.

Spike acotado: máximo 25 candidatos, 2 páginas/listados y detalles solo de candidatos de ventas; timeout 30 s, concurrencia 1 por host, caché mínima 6 h salvo política más estricta, sin refresh continuo. Coste HTTP y proveedor medidos por separado; no llamar LLM sobre duplicados. Para ATS: máximo 3 tenants durante el spike, mismos límites por tenant. Revalidación de una oferta concreta tiene presupuesto separado.

Antes de activar: verificar interfaz y condiciones/atribución/redistribución; registrar política con enlace y fecha. Distribución desconocida bloquea publicación externa. Preferir API/feed oficial; HTML y después proveedor hosted solo si el acceso está permitido y hay retorno útil. Login/bloqueo no se resuelve con cookies personales.

## Criterios de aceptación pendientes

- [ ] Listado y detalle recuperados sin sesión personal; canary documentado con coste.
- [ ] Diez fixtures anonimizados si hay volumen: relevantes, cero resultados, presencial, US-only, idioma ambiguo, caducada y campos ausentes.
- [ ] 429, timeout, cambio de esquema y paginación parcial no rompen otras fuentes.
- [ ] ID/hash estable, raw inmutable, dedupe contra ATS y fuentes sindicadas.
- [ ] Medir oportunidades activas ES/LATAM + español/bilingüe por 100 candidatos y coste por útil; pausar si yield no compensa.
- [ ] Preview de alumna con siguiente paso honesto y atribución; admin con trazabilidad completa.

Reglas compartidas: [investigación US](../18_US_HISPANIC_SOURCE_RESEARCH.md), [conectores](../05_CONNECTORS.md), [experiencia](../17_WDC_OPPORTUNITY_EXPERIENCE.md).
