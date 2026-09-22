# ADR-008 — Adquisición diaria separada de búsqueda

Estado: aceptada por petición del usuario, implementación local 2026-09-22.

## Decisión

La petición más reciente sustituye la consulta interactiva a fuentes por un catálogo local de diez días, alimentado una vez al día por las conexiones activas. Prioridad sobre el orden de implementación de ADR-007, sin sustituir su dominio futuro WDCOpportunity ni portal de alumnas.

La adquisición tiene cola, progreso y presupuesto independientes. La búsqueda solo filtra datos locales y sigue guardando sus filtros y resultados. Una organización y día Madrid identifican un único lote. El presupuesto de scraping es 1 € por defecto, máximo configurable 2 €, con reservas atómicas compartidas por lanzamientos manuales y programados, validación PPE/FX y margen de conversión. La incertidumbre no autoriza reintentos.

La antigüedad se cuenta desde primera incorporación. No se reinicia por redescubrimiento, incluso desde otra conexión con URL exacta. A los diez días desaparece de la superficie de búsqueda e histórico de resultados; se conserva evidencia técnica inmutable y la identidad archivada. Las capturas originales y el historial no se presentan como ofertas activas verificadas.

## Consecuencias

Buscar no consume créditos de scraping ni tokens. Una fuente caída no bloquea el resto. El catálogo puede estar vacío si no hay ofertas que cumplan los requisitos, sin inventarlas ni ampliar idioma/modalidad. El coste de cuenta Apify, IA y actividades externas requiere límites propios: el presupuesto de eventos no es garantía de factura final en EUR.

El worker local necesita app y ordenador encendidos. No hay cron cloud, login multiusuario ni portal de alumnas por esta decisión. Ver [operación](../DAILY_CATALOG.md) y [estado](../STATUS.md).
