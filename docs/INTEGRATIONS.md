> Actualización 2026-09-22: buscar utiliza ahora el catálogo local de diez días. La recogida diaria y los lanzamientos manuales comparten presupuesto; ver [Catálogo diario](DAILY_CATALOG.md). Las instrucciones de extracción anteriores se mantienen como contexto técnico.

# Conexiones y análisis de ofertas

Estado operativo actual: MVP local con Apify y análisis individual Groq/OpenAI mediante LLMProvider. Groq es principal por defecto; cada proveedor conserva su clave. En Fuentes → Motor de IA elige proveedor, pega su clave, guarda y comprueba. Cambiar de proveedor limpia la clave escrita para no enviarla al destino incorrecto. Configuración masiva/por tarea sigue pendiente: ver [16](spec/16_LLM_PROVIDER_GROQ.md) y [PLAN](PLAN.md).

En Fuentes, abrir Cuenta de Apify, guardar la clave y comprobarla. La comprobación consulta la cuenta; no ejecuta un Actor. Las conexiones heredan esta clave, salvo las que tengan una clave específica.

Pulsar Conectar en el catálogo o Añadir fuente. Elegir proveedor, pegar enlaces si corresponde y preparar. El servidor busca candidatos, inspecciona esquema, versión y modalidad de precio y propone una configuración. Guardarla no consume una extracción. Ejecutar scraper es una acción separada; Buscar lee el dataset disponible. Las fuentes del catálogo no son una garantía de scraper operativo: esquemas incompatibles requieren configuración avanzada y la primera salida necesita verificación.

El asistente acepta proveedores con cobro por evento/resultado y límite reconocido. Solicita al proveedor el máximo de cargos indicado; no es una estimación del coste total. Por defecto pide 25 resultados y 1 USD. Reutiliza durante seis horas un dataset completado con los mismos parámetros. Los metadatos públicos también se cachean. Si el Actor solo admite una palabra clave, se prepara el primer término; para buscar otros, editar el término o aportar un enlace de búsqueda. Los términos de un enlace dependen de ese enlace.

En Motor de IA, guardar una clave del proveedor seleccionado, elegir modelo, límite diario y activar. Comprobar consulta acceso al modelo sin generar contenido. En el detalle de una oferta, Analizar crea una tarea persistida y procesa únicamente esa oferta. No envía el histórico de conversación ni todo el dataset. Entrada limitada a 6.000 caracteres y salida a 900 tokens en Groq/600 en OpenAI; el análisis de textos largos puede ser incompleto. Se guarda proveedor, modelo, versión de prompt, respuesta, uso, latencia y evidencia. El coste monetario depende del proveedor/modelo y no se calcula en la app.

La misma oferta/contenido/modelo/prompt reutiliza su resultado. El límite diario (20 por defecto, UTC) cuenta solicitudes reservadas, incluidas fallidas. Las respuestas se validan contra un esquema y sus citas deben existir literalmente en la oferta. Una respuesta puede seguir siendo incorrecta: revisión humana antes de compartir o aplicar. Las llamadas fallidas o interrumpidas no se reintentan automáticamente para evitar cargos duplicados.

Claves guardadas en archivos locales con permisos 0600 junto al almacenamiento privado de la aplicación; no están cifradas en reposo. Nunca se devuelven al navegador, ni se incluyen en contratos o Git. Este mecanismo corresponde al MVP local; publicación multiusuario requiere gestor de secretos, autenticación y permisos de producción.

Migración SQLite v2 aditiva y transaccional: ajustes de integraciones, planes preparados y generaciones. Conserva raws e histórico. OpenAPI es la fuente de tipos del frontend.

Validación automatizada: servidor HTTP local que reproduce el contrato externo, base SQLite real y worker real; no requiere claves reales ni incurre en costes. La verificación pública de preparación InfoJobs no sustituye una ejecución real autenticada. No se han validado todas las fuentes ni todos los modelos contra sus proveedores.
