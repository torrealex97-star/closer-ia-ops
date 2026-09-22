# Preview de alumna WDC

La alumna compara empresa, puesto y condiciones antes de elegir. El inicio `/` contiene Oportunidades y Guardadas; la administración de fuentes, gastos y proveedores permanece en `/admin`.

## Criterios

Tres perfiles: Closer, Setter y Cold Caller. Un comercial genérico se clasifica como Closer solo con evidencia de cierre en el texto. La adquisición incluye Cold Caller, conservando los filtros español/remoto e identidad por fuente.

La vista por defecto exige descripción suficientemente española y excluye requisitos explícitos de inglés. La opción bilingüe admite anuncios con español requerido o texto español, pero nunca trabajo exclusivamente/principalmente inglés ni español solo deseable. La detección es por reglas conservadoras y puede omitir anuncios ambiguos; no usa tokens ni traduce automáticamente. El texto original permanece en detalle y las ofertas bilingües pueden tener original inglés al seleccionarlas expresamente.

La compensación muestra contexto publicado, cifras y unidad solo cuando constan. Promedios/comisiones permanecen variables. Si solo se publica “base + comisiones”, no se inventa el importe. Las tarjetas muestran ubicación, modalidad, idioma, horario, experiencia y contrato; desconocidos son explícitos. La referencia temporal es publicación original, distinta de incorporación al catálogo.

## API

POST /v1/opportunities/search: role (closer/setter/cold_caller, null para guardadas), market, days (1–10), include_bilingual y starred_only. Respuesta allowlist OpportunityList: sin proveedores técnicos, score o raw. La atribución con enlace permanece visible en cada tarjeta. El CTA abre la publicación original y no envía candidaturas ni presupone acuerdo WDC.

Se reutiliza la acción local de marcadores y el catálogo de diez días. No se crean búsquedas históricas al cargar esta vista ni llamadas al proveedor. Es un preview monousuario: no hay login de alumnas, protección por rol entre rutas ni bookmarks individuales todavía. Sigue prohibido publicar este modo local en internet.

## Dirección visual

Se conservan papel, terracota, salvia y grises cálidos WDC; Libre Caslon Display para titulares y DM Sans para información. Foco de tarjeta: empresa + perfil y compensación en superficie terracota clara, seguido por datos de decisión. Base de espaciado 4 px; tarjetas 24 px (20 px móvil), dos columnas escritorio y una móvil; controles nativos y diálogo con Escape. Sin scores, CSV, tokens, scrapers ni métricas operativas en la vista de alumna.
