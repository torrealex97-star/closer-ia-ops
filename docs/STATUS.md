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

## Próximo incremento

1. Medir calidad de consultas Closer España, Setter LATAM y ventas hispanohablantes; mejorar taxonomía con fixtures reales anonimizados. No presentar score como probabilidad.
2. Extraer esquema local a migraciones versionadas y preparar transición Postgres antes de funciones multiusuario. El aislamiento local actual no equivale a RLS.
3. Añadir dedupe conservador entre fuentes y corrección manual; hoy solo hay dedupe por source/external_id.
4. Validar fuentes críticas cuando existan proveedores/credenciales. No aparecen operativas en UI.
5. Mejorar estabilidad de arranque local y paginación/histórico antes de ampliar módulos.

## Pendiente de siguientes fases

Supabase/Auth/RLS, portal de alumnas, clasificación IA y gold set, publicación externa con políticas por fuente, programación de búsquedas, fallback real entre proveedores, roleplays, entrevistas y autoapply. Ver PLAN y ADR-006. Las búsquedas guardadas hoy se repiten manualmente.
