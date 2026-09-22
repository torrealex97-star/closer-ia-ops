# UI / UX — dos superficies

Objetivo según [ADR-007](../decisions/ADR-007-groq-opportunity-surfaces.md). El runtime actual es una mesa administrativa local. Esta revisión especifica el preview y posterior portal de alumnas, no afirma que estén implementados.

## Admin / staff

Mantener Search Builder, Live Run, resultados progresivos, selección, historial, exportación y gestión de fuentes. Datos técnicos visibles aquí: source, provider, Actor/version, source_url, canonical_url, external_id, raw, job_posting, scrape_run/provider_used, first_seen, last_verified, duplicados, confianza por campo y relevancia orientativa.

Fuentes: asistentes comprensibles con controles avanzados colapsados; catálogo distingue disponible, por conectar, en validación y bloqueada. No presentar todos los sitios investigados como funcionando.

Motor IA: Groq principal, estado de clave/modelos/capabilities, límites de gasto/tokens y uso; sin secretos al reabrir. Proveedor secundario futuro explícito. Mostrar rate limited/en cola/revisión, sin lanzar retries facturables al refrescar.

Detalle admin añade estado editorial, vigencia, evidencias de relación, correcciones auditadas y Preview alumna. Revisar/publicar separado de ejecutar scraper. Score nunca rotulado como probabilidad.

## Alumna

La pregunta principal es “¿Qué empresa busca un perfil como el mío, con qué condiciones y cómo avanzo?”. Ficha: empresa → puesto → remoto/híbrido y países permitidos → fijo/comisiones/potencial declarado → idioma/experiencia → qué buscan y qué harías → estado y fecha → acción.

Contrato, copy y matriz de CTA normativos en [17](17_WDC_OPPORTUNITY_EXPERIENCE.md). No mostrar fuentes como columna protagonista. Procedencia en detalles o atribución obligatoria, sin ocultar destino real al continuar.

Activa/Verificando/Cerrada con texto/icono/color; fecha original independiente de descubierta. Desconocidos explícitos. “Seleccionada por WDC” exige selección registrada; “conexión directa” exige relación vigente. Sin perfil no fingir personalización.

Aplicar ahora / Solicitar conexión / Enviar candidatura / Contactar recruiter / Continuar candidatura / Ver proceso se resuelven por application_type y relación. Si falta URL/canal o está cerrada, acción deshabilitada con motivo, nunca botón vacío. Antes de salida externa identificar dominio/plataforma y posible cuenta; sin envío automático.

## Estados y accesibilidad

Admin: empty, queued, partial, degraded, no results, completed, cancelled, failed, export/publish pending/success/error.
Alumna: loading, empty con filtros accionables, active, verifying, closed, restricción geográfica, proceso externo, referral pending y acceso denegado.

Responsive: admin desktop-first, tablet y móvil sin overflow; portal alumna mobile-first, CTA legible, foco/teclado, contraste y semántica accesible. No depender solo del color. Diseño visual existente de WDC se conserva; ver [DESIGN](../DESIGN.md).

## Aceptación

Un admin llega desde raw hasta el preview sin perder provenance. Una alumna identifica empresa/rol/condiciones/siguiente paso sin entender conectores. Su respuesta API no contiene raw, provider, tokens, costes, contactos privados o evidencias internas de partnership. Fuente visible cuando corresponda a política. Pruebas cubren los seis connection_type, estados, unknown company/salary/date y móvil.
