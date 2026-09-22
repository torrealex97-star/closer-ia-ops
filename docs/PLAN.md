# Plan de producto

Producto independiente para preparar personas y conectarlas con empresas. WDC es la primera organización; marca, programas y puestos son configuración.

## Entregas incrementales

1. **MVP local operativo (activo):** repositorio, web, API, worker, evidencia original inmutable, búsqueda progresiva en fuentes públicas, filtros verificables, historial, selección, copia y exportación. Pruebas de fallos parciales, persistencia y recorrido en navegador.
2. **Cobertura para closers (activa):** priorizar español/bilingüe para alumnas hispanas y puestos remotos o híbridos, incluyendo Europa. Seis feeds públicos, catálogo ampliable y conexiones Apify configurables desde Fuentes. Validar primero InfoJobs, Computrabajo y LinkedIn con credenciales del operador; después Workana, bolsas hispanas, comunidades y empresas. Medir oportunidades útiles/coste y falsos positivos antes de activar más proveedores. Ver SOURCES.md. Conectar IA solo donde mejore clasificación medida.
3. **Acceso online seguro:** Supabase independiente, organizaciones, membresías, permisos, RLS y despliegue; login para equipo y luego alumnas. Migración del histórico local.
4. **Portal y matching:** perfiles, programas, preferencias, ofertas seleccionadas, seguimiento de candidaturas y conexión con empresas colaboradoras.
5. **Preparación:** roleplays con IA, rúbricas por profesión, feedback y simulación de entrevistas; progreso y revisión por mentoras.
6. **Aplicaciones asistidas y autoapply:** perfil validado, autorización, adaptadores separados, idempotencia y verificación del envío.

Cada entrega requiere comportamiento real, pruebas y actualización de STATUS. No adelantar módulos por facilidad. La primera entrega no equivale a aceptar todos los requisitos del MVP original.

## Evolución diaria

Trabajar una mejora pequeña del backlog por ejecución, priorizando fallos reproducibles y utilidad del buscador. Mantener una única línea de trabajo. No consumir servicios de pago, publicar aplicaciones ni contactar terceros sin configuración/autorización. Notificar avances verificables o bloqueos accionables.

## Proyecto separado

El descubrimiento de influencers IG/TikTok/YouTube/LinkedIn se desarrollará en el repo de Scalix como herramienta independiente. Compartir código versionado cuando exista reutilización concreta, nunca datos o dependencias internas entre repositorios.
