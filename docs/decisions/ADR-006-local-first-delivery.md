# ADR-006 — Primera entrega local y evolución multiempresa

Fecha: 2026-09-22. Estado: decisión de implementación para la petición de MVP utilizable y confirmación «empieza en local».

El repositorio es independiente de Scalix. WDC es la primera configuración. Conservamos Next.js, FastAPI, contratos OpenAPI y worker explícito.

Para uso inmediato sin infraestructura, la primera entrega opera exclusivamente en loopback, con SQLite persistente y cola durable local. Un secreto efímero generado por el lanzador protege API y proxy contra llamadas desde otros orígenes. No representa login de alumnas ni autenticación de producción. No se habilita despliegue público de este modo.

Supabase/Postgres/Auth/Queues sigue siendo el destino de producción; antes de publicarlo se requiere migración y prueba de aislamiento, autenticación y RLS. Toda consulta local se acota ya por organización. No se presume que SQLite implemente RLS.

Se reorganiza la entrega por cortes funcionales: primero APIs/feeds públicos verificados (Himalayas y We Work Remotely), después fuentes críticas con credenciales y proveedores probados. LinkedIn/Upwork/Facebook/Skool no se presentan como operativos. La meta de 20–30 resultados sigue condicionada a oferta real.

Primera entrega: extracción determinista, coincidencia explicable, historial, selección, copia y CSV/XLSX/JSON. No hay clasificación IA hasta integrar y evaluar un proveedor; no se declaran alcanzadas las métricas del gold set.

Sin auto-publicación, autoapply, portal ni simulaciones en este corte. La programación diaria de mejoras es mantenimiento del proyecto, no publicación automática de ofertas.

Las versiones exactas se verifican en los registros y quedan fijadas en lockfiles; sustituyen los números del spec cuando sea necesario.
