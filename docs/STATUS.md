# Estado

## Fuentes filtradas y referencias del Excel — 2026-09-22

- Catálogo de 35 entradas con método, filtros en origen y estado explícito. Candidatos revisados para 20 rutas adicionales; nueve rutas sin proveedor verificado. No se presentan metadatos como extracción validada.
- 51 referencias del Excel WDC disponibles en el asistente por fuente y organización: español primero; no se convierten automáticamente en conexiones ni ofertas. Añadidos Jooble y SimplyHired.
- El asistente muestra filtros aplicados/pendientes e Input exacto, preserva URLs filtradas, evita defaults de ubicación ajenos, rechaza pérdida silenciosa de keywords, reparte límites por consulta y desactiva enriquecimientos opcionales reconocidos.
- Remotive consulta categoría sales; WWR RSS de ventas y marketing. Facebook grupos usa proveedor específico público, fecha relativa diez días y límite; keyword en origen no garantizada. Contratación explícita en posts reconocida sin convertir autopromoción en ofertas.
- Validación: 71 backend, 10 Playwright, build/TypeScript y Ruff PASS; preparaciones reales InfoJobs/Facebook con metadatos, sin lanzar scrapers ni IA. Preview reiniciado conservando DB. Detalles y pendientes en SOURCE_ACQUISITION.md.

## Prioridad España y cobertura conjunta — 2026-09-22

- Recogida Himalayas consulta España antes del pool mundial; se elimina el corte global de 180 registros y una página duplicada ya no detiene la paginación. Límite operativo de tres páginas por término/mercado, caché y timeout conservados: no se afirma cobertura exhaustiva de internet.
- Alumna inicia con todos los perfiles; conserva filtros Closer/Setter/Cold Caller. La proyección reúne todas las fuentes guardadas sin selección de proveedor y prioriza ubicaciones explícitas España. Europa/UE reconocidas en el filtro ES. Siguen las restricciones de idioma, modalidad, publicación y caducidad.
- Actualización gratuita real: 719 registros revisados en seis fuentes, cuatro oportunidades visibles y cero para España con los criterios actuales. Datasets InfoJobs comprobados: cero registros antes del filtrado. Conexión LinkedIn existente corregida de United States a Spain para su siguiente extracción, sin lanzar Actor.
- Validación: 63 backend y 9 Playwright PASS; build/TypeScript y Ruff PASS. Incluye mezcla de origen público/Apify, perfiles, prioridad ES, exclusión de México para ES y paginación con duplicados. No consumo de IA ni nuevos scrapers de pago.

## Oportunidades para la alumna — 2026-09-22

- Inicio `/` sustituido por la experiencia de alumna: Closer, Setter y Cold Caller, carga inicial de ofertas, guardadas, tarjetas de condiciones y siguiente paso hacia la publicación original. Gestión local conservada en `/admin`, sin controles operativos en la navegación de alumna.
- POST `/v1/opportunities/search` devuelve DTO permitido con empresa, perfil, compensación, modalidad, ubicación, idioma, jornada, experiencia, contrato y atribución. No expone raw_id, provider, score, coste ni configuración. Sin uso de IA o scraping al buscar.
- Se excluyen anuncios solo en inglés, trabajo declarado exclusivamente/principalmente en inglés y español opcional/secundario. Por defecto la alumna ve anuncios en español; bilingües con requisito real de español requieren marcar la opción. Reglas deterministas conservadoras, no clasificación lingüística perfecta.
- Remuneración extraída con contexto literal: fijo/variable, sin convertir promedios en garantías ni inventar periodicidad. Las cifras ausentes siguen como no publicadas. Roles comerciales solo se presentan como Closer cuando hay evidencia de cierre; título Setter/Cold Caller tiene prioridad.
- Cold Caller incorporado a consultas públicas, asistentes y palabras clave de la conexión InfoJobs existente para su siguiente recogida. Sin lanzar Actor ni generar consumo adicional.
- Validación: 61 backend PASS, 9 Playwright PASS, build/TypeScript y Ruff PASS; revisión visual escritorio/móvil y consulta real con cuatro ofertas en español. Pruebas adicionales de presentación tras pulido de compensación.
- Es preview local de la experiencia, no portal multiusuario: `/admin` separado visualmente no es autorización por rol. Guardadas sigue por organización local; Auth/RLS/membresías y guardadas por alumna pendientes. No se afirma relación directa con las empresas ni candidatura enviada.

## Catálogo diario y presupuesto — 2026-09-22

- Recogida automática local a las 08:00 Europe/Madrid; presupuesto inicial 1 € de scraping, ajustable a 2 €, pausa y botón idempotente de recogida del día. Todos los conectores públicos y conexiones activas se incorporan al lote; una conexión añadida tras cerrarse el lote entra al siguiente día.
- Buscar ahora consulta SQLite: ninguna llamada a proveedores, scraper o IA. Pool de ventas digitales en español con remoto/híbrido; búsqueda y contador excluyen históricos heredados fuera de ese perfil. Filtros de publicación 1/3/7/10 días; fecha desconocida sigue identificada como tal.
- Retirada del catálogo y snapshots buscables diez días desde primera incorporación, incluso marcadas; metadatos de búsquedas y evidencia técnica inmutable se conservan. Redescarga no renueva la fecha. Dedupe conservador por URL original exacta dentro de la organización; no agrupación semántica.
- Migración aditiva v4 con backfill desde primera captura; copia de seguridad local previa. Reservas SQLite atómicas por organización/día/fuente, compartidas con ejecución manual. No liberan saldo por consumo bajo; un lanzamiento incierto bloquea nuevas ejecuciones hasta revisión. Reinicio reanuda importación sin repetir POST facturable. Las reservas liquidadas después de medianoche también cuentan ese día.
- Solo nuevos Actors PPE con precio y cambio verificables; límite agregado convertido a USD con margen 30 %. No equivale a un tope de factura: excluye cuotas, impuestos, almacenamiento, IA y ejecuciones fuera de esta app. Sin FX vigente o esquema compatible se omite el lanzamiento y se intenta importar dataset previo.
- Primera recogida real finalizada: 678 registros públicos revisados, seis coincidencias en Himalayas y cero registros en el dataset existente InfoJobs. Se reutilizó la extracción reciente de InfoJobs; no se lanzó un nuevo Actor ni se gastaron créditos para las pruebas.
- Verificación final: 54 backend y 7 Playwright PASS, build/TypeScript y Ruff PASS. Incluye prueba con presupuesto Apify agotado y fuente pública que sigue importando. Catálogo real: siete ofertas elegibles contando incorporaciones previas; el reinicio conserva el mismo lote y reserva de hoy 0 €. Más detalle operativo en DAILY_CATALOG.md. Se mantiene el despliegue local: necesita app y ordenador encendidos; no ejecuta desde la nube ni recupera días perdidos.

## Red de oportunidades — 2026-09-22

- Navegación y presentación renombradas a «Red de oportunidades», sin atribuir acuerdos de colaboración a portales externos. Configuración técnica conservada en el panel administrativo local.
- Buscar consulta el dataset Apify existente; la extracción se inicia con «Ejecutar scraper». Conectar la cuenta no activa una extracción automática de InfoJobs.
- Verificación: build/TypeScript, 45 pruebas backend y 6 pruebas Playwright PASS; sin llamadas facturables a proveedores.

## Última entrega — Groq visible en preview (2026-09-22)

- Conexión Groq implementada en Fuentes → Motor de IA; default para nuevas configuraciones, GPT-OSS 20B/120B, clave propia, guardar/comprobar y límites diarios. OpenAI permanece seleccionable con clave independiente.
- LLMProvider con adaptadores Groq Chat Completions strict JSON y OpenAI Responses. Análisis individual persistido, proveedor/modelo/caché/uso/latencia/error; no cambios automáticos de proveedor ni reintentos facturables. Respuesta incierta y truncada no se muestran como análisis válido.
- Migración v3 etiqueta generaciones heredadas como OpenAI sin modificar raws. Provider separado en clave de caché. Tipos de configuración generados desde OpenAPI; clave escrita se borra al cambiar de proveedor.
- Verificación: 45 backend PASS; tras ajuste final de validación sin eco de secretos, 11 integraciones PASS; 6 Playwright PASS; build/TypeScript y Ruff PASS. Preview e IAB muestran Groq. No canary de generación real ni consumo de créditos.
- P05A parcialmente entregada: falta procesamiento masivo, configuración por tarea, presupuestos monetarios/reservas, rate limiting coordinado, retries 429 acotados, benchmark/gold set y canary con clave WDC. Se mantiene un worker secuencial y límite diario de solicitudes; esta entrega no afirma fase completa.
- WDCOpportunity/portal y nuevas fuentes US siguen pendientes. La app sigue local en 127.0.0.1:3100.

Primera entrega local implementada el 2026-09-22. No desplegada en internet. No existen credenciales WDC ni proyecto Supabase configurado. Repositorio Git local independiente; sin remoto.

## Disponible

- Web Next.js, API FastAPI y worker con cola SQLite durable.
- Búsqueda progresiva en Himalayas y We Work Remotely; filtros de perfil, mercado, fecha, idioma y compensación.
- Revisión de condiciones inciertas, detalle con evidencia y enlace original, selección y marcadores.
- Historial, filtros guardados, copia y CSV/XLSX/JSON con selección y protección contra fórmulas.
- Capturas inmutables, relaciones por organización, dedupe por identidad de publicación, reintentos idempotentes y fallos parciales.
- Tipos generados desde OpenAPI, lockfiles y workflow CI configurado.

## Verificación ejecutada

- 12 pruebas backend PASS: autenticación local, aislamiento, idempotencia, raw inmutable, filtros estrictos, expiración, relevancia, fallos parciales, progreso, exportación y contratos de proveedores.
- 2 pruebas Playwright PASS: controles, navegación, viewport móvil sin overflow y rechazo de origen externo.
- TypeScript PASS y build Next.js PASS.
- Ruff PASS sobre la copia de ejecución sincronizada.
- Búsqueda real amplia: 154 publicaciones de Himalayas y 82 de WWR; ambas fuentes finalizaron correctamente en aproximadamente 10 segundos. La primera calibración aceptaba demasiadas menciones genéricas; se añadió regla de contratación explícita y prueba de regresión. No es evaluación formal de precisión/recall.
- Búsqueda posterior de Closer con el filtro corregido: 147 publicaciones de Himalayas y 82 de WWR revisadas; 43 candidatos aceptados (43/0 por fuente), aproximadamente 3,4 segundos con parte de la caché ya caliente. La UI muestra las 30 primeras y permite ver todas. No supone 43 ofertas aptas para España: el mercado de esta prueba era global/sin restricción.
- Navegador real: búsqueda, resultados, selección, apertura/cierre de detalle y click de exportación CSV. API de exportación 200 y contenidos CSV/XLSX/JSON verificados por tests.
- CI remoto no ejecutado: no existe remoto GitHub. No afirmar producción ni aceptación completa del MVP original.

## Operación actual

Vista previa en http://127.0.0.1:3100 . Se ejecuta desde una copia temporal por restricciones de acceso del entorno a Documents; los datos activos se guardan fuera de /tmp. Ubicación, comando y recuperación en `.local/SESSION.md` (ignorado por Git). No borrar esa base ni reemplazarla por la vacía del repo.

Automatización «Mejora diaria WDC» activa a las 09:00 (hora local), vinculada a esta tarea. Requiere entorno local disponible. Una mejora comprobable por ejecución, sin servicios de pago ni publicación/contactos automáticos.

## Ampliación de fuentes — 2026-09-22

- Catálogo de 33 entradas priorizando España/LATAM, Europa, freelance, comunidades y empresas. Seis conectores públicos operativos: Himalayas, WWR, Get on Board, Remotive, Remote OK y Arbeitnow. El catálogo incluye rutas configurables, no 33 scrapers validados.
- Fuentes permite crear/editar conexiones Apify por organización: token local, Actor/dataset, URLs, Input JSON, mapeo, límites y activación. InfoJobs precarga términos y esquema según documentación del Actor.
- Ejecución de scraping explícita, bloqueo de duplicados/respuestas inciertas y comprobación de estado/coste. Buscar solo lee el dataset, sin iniciar ejecuciones de pago.
- Perfil inicial «Closers, setters y comercial online», aliases españoles, filtro de evidencia de español/bilingüe independiente de campos desconocidos y modalidad remota/híbrida. Mercado Europa añadido.
- Primera búsqueda de calibración: seis fuentes respondieron y produjo 51 resultados; se detectaron falsos positivos en portugués y puestos de dirección. Se corrigió la heurística y se añadió un perfil más específico y regresión. Ese recuento no es el resultado final ni precisión validada.
- Segunda búsqueda con el perfil específico: 679 publicaciones revisadas en las seis fuentes; 12 resultados (9 Himalayas y 3 Get on Board), en unos 5,3 segundos con caché parcial. Se identificó un coordinador de inteligencia comercial y se añadió exclusión de perfiles de análisis/dirección al perfil inicial. El histórico conserva las capturas originales de cada búsqueda.
- 34 tests backend, 3 Playwright, build Next/TypeScript y Ruff PASS en la copia sincronizada. Browser verifica edición de enlaces, token no devuelto, plantilla InfoJobs, navegación y viewport móvil. La conexión Apify se prueba con fixtures, no con créditos reales.
- Documentación de configuración, cobertura, límites y referencias en SOURCES.md. No se añadieron servicios externos de pago ni credenciales de otras empresas.

## Próximo incremento

### Entrega de integraciones guiadas e IA — 2026-09-22

- Cuenta Apify compartida desde Fuentes: guardar, comprobar sin ejecutar y desconectar. Asistente por fuente/enlaces/términos, descubrimiento de Actor, inspección de esquema y precio, versión fijada y preparación persistida con caducidad. Configuración avanzada como alternativa cuando el esquema no es compatible.
- OpenAI conectable desde Fuentes; análisis de una oferta bajo demanda con evidencia literal, requisitos y preguntas. Cola durable, resultados persistidos, caché por contenido/modelo/prompt, consumo de tokens registrado y límite diario. No se incorpora IA al filtrado masivo ni se considera validada su precisión.
- Eficiencia: 25 resultados y límite solicitado de 1 USD por defecto en asistente; reutilización durante seis horas de extracciones idénticas completadas. IA: 6.000 caracteres de entrada, 600 tokens máximos de salida y 20 solicitudes diarias por defecto. Sin reintentos automáticos de llamadas de pago inciertas.
- Corregidos estados atascados por datasets inválidos, recuperación accidental del dataset anterior al editar, sobrescrituras de estado concurrentes y pérdida de selección de fuentes. Histórico lee únicamente las columnas necesarias.
- Migración local aditiva versionada v2 implementada y probada conservando evidencia existente. No equivale a la migración futura a Postgres/RLS.
- Validación: 40 pruebas backend, cinco Playwright, Ruff y build con TypeScript PASS. Integraciones recorren HTTP real contra servidor de contrato local, API, SQLite y worker; cubren errores, caché, límites, aislamiento y evidencia inventada. Revisión visual en navegador local.
- Preparación InfoJobs verificada contra metadatos públicos reales de Apify (Actor haketa/infojobs-scraper, build 0.1.1); no se ejecutó scraper ni generación real de pago. Pendiente prueba con credenciales propias WDC. No se usaron secretos de Scalix.
- Detalles de operación y límites: INTEGRATIONS.md.

1. Medir calidad de consultas Closer España, Setter LATAM y ventas hispanohablantes; mejorar taxonomía con fixtures reales anonimizados. No presentar score como probabilidad.
2. Ampliar las migraciones locales versionadas ya incorporadas y preparar transición Postgres antes de funciones multiusuario. El aislamiento local actual no equivale a RLS.
3. Añadir dedupe conservador entre fuentes y corrección manual; hoy solo hay dedupe por source/external_id.
4. Validar Actors de InfoJobs/Computrabajo/LinkedIn cuando el operador conecte credenciales. Ampliar plantillas con esquemas comprobados, versionar configuración por búsqueda y mejorar paginación; no dar por operativa una fuente solo por figurar en el catálogo.
5. Mejorar estabilidad de arranque local y paginación/histórico antes de ampliar módulos.

## Pendiente de siguientes fases

Supabase/Auth/RLS, portal de alumnas, clasificación IA y gold set, publicación externa con políticas por fuente, programación de búsquedas, fallback real entre proveedores, roleplays, entrevistas y autoapply. Ver PLAN y ADR-006. Las búsquedas guardadas hoy se repiten manualmente.

## Revisión de arquitectura — Groq, US y WDC Opportunity (2026-09-22)

- Actualización documental solicitada, registrada en ADR-007. MASTER SPEC, alcance, arquitectura, dominio, búsqueda, conectores, contratos objetivo, UX, publicación, operación, aceptación y fases alineados.
- Nuevos documentos: LLMProvider/Groq; WDCOpportunity/CTA/vigencia; investigación US; 17 fichas de fuentes; seis fases de implementación y registro de revisión documental.
- Groq será default; el código sigue usando OpenAI para análisis individual. No se añadió adaptador, variable activa, endpoint ejecutable, tabla nueva ni conexión real con Groq en esta entrega.
- Fuentes nuevas incorporadas a documentación/backlog, no al catálogo runtime. Acceso público y límites investigados con referencias; ninguno de estos scrapers se ejecutó ni consumió créditos.
- Próximo incremento: P05A_GROQ_PROVIDER, después P01B_OPPORTUNITY_DOMAIN, P04K por lotes, P05B y P06B; PLAN prevalece sobre el backlog anterior.
- Portal de alumnas, conexiones directas y políticas de publicación descritos como objetivo; no implementados por crear sus MD.
- Verificación de esta entrega: referencias Markdown locales, inventario, cobertura de requisitos y diff; no se han vuelto a ejecutar las suites runtime porque no cambió código. Los resultados de 40 backend/5 navegador anteriores corresponden a la entrega de integraciones.
