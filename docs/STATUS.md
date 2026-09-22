# Estado

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
