# Catálogo diario de oportunidades

## Uso

Oportunidades busca solo en las ofertas guardadas durante los últimos diez días. No ejecuta proveedores ni IA. El catálogo reúne coincidencias de closer, setter y comercial digital con evidencia de español y trabajo remoto/híbrido. Publicación original y fecha de incorporación son distintas: una oferta descubierta hoy no se anuncia como publicada hoy si no hay evidencia.

En Red de oportunidades se configura la recogida: activa por defecto, 08:00 Europe/Madrid, 1 € diario de scraping, seleccionable hasta 2 €. El botón «Recoger ofertas de hoy» encola el mismo lote del día; repetirlo no crea otro. Las nuevas conexiones activas entran en el siguiente lote. Desactivar la programación impide nuevos lotes automáticos; uno ya iniciado puede terminar. La recogida manual sigue disponible.

El worker requiere ordenador y app abiertos. Si arranca pasada la hora, recoge el día actual una vez; no ejecuta un lote por cada día perdido. Cambiar la hora no reabre un lote finalizado. Hora de Madrid incluye cambio de horario estacional.

## Presupuesto y límites

Se reparte la reserva diaria entre conexiones de pago del lote. Antes de un POST se valida precio actual PPE y cambio USD/EUR del BCE, como máximo siete días de antigüedad. Se convierte con margen del 30 % y se envía maxTotalChargeUsd. Cada lanzamiento reserva céntimos en una transacción junto a su estado STARTING. La suma incluye manuales y automáticos. No se libera lo reservado cuando el consumo real es menor. Los costes informados por usageTotalUsd se muestran como uso comunicado por Apify, no como una factura completa.

Las reservas terminadas otro día se cuentan tanto el día de inicio como el de comprobación terminal. Los lanzamientos inciertos se bloquean sin reintento facturable y conservan la reserva; revisión manual en la consola permite desbloquearlos, sin devolver el saldo de ese día. Un actor con precio mínimo superior a su parte del presupuesto, precio incompatible, costes adicionales detectados o FX no verificable se omite; no amplía el límite. El resto de fuentes continúa.

El límite corresponde a eventos de scraping iniciados desde esta app. No limita cuotas, impuestos, almacenamiento, consumos de IA ni ejecuciones desde Apify u otras herramientas. Se usa un único worker local. Un tope absoluto de factura en euros exigiría controles en la cuenta del proveedor y la facturación, además de este mecanismo. No se lanzan análisis IA en lote.

## Conservación

first_seen_at determina la retirada a los diez días; no se renueva cuando reaparece el mismo ID o URL original exacta. No se deduplican por parecido de título. Las ofertas expiradas se excluyen inmediatamente al leer y se eliminan de los snapshots de búsqueda durante la limpieza periódica. También salen las marcadas. Metadatos de búsquedas, capturas inmutables y huellas de identidad quedan para auditoría y para evitar reintroducir publicaciones antiguas. Esto no es un borrado físico de evidencia ni elimina datasets remotos de Apify.

La migración usa la primera captura existente sin alterar los raws. Los históricos fuera del perfil WDC no se añaden a la selección visible del catálogo. Las publicaciones que expiran en origen se descartan al filtrar su última versión normalizada.

## API y operación

- GET /v1/collection: estado, ofertas, reservas, configuración y fuentes del último lote.
- PUT /v1/collection/settings: enabled, daily_budget_eur (1 o 2), hour (0–23).
- POST /v1/collection/refresh: lote idempotente por organización y fecha Madrid.
- POST /v1/search-runs: misma interfaz, ejecución ahora exclusivamente sobre catálogo.

Tablas v4: catalog_entries, collection_runs, scrape_budget. El worker independiente procesa el lote; la cola de búsquedas no espera al scraping. Las conexiones ya existentes se conservan. La automatización de mantenimiento de Codex no ejecuta estos lotes ni gestiona el presupuesto.

Referencias verificadas el 2026-09-22: [límite por ejecución PPE](https://docs.apify.com/actors/publishing/monetize/pay-per-event), [API Run Actor](https://docs.apify.com/api/v2/actors-runs-post), [cambio BCE](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml).
