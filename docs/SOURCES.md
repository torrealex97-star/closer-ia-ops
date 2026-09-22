# Fuentes y búsquedas para WDC

Actualizado: 2026-09-22. Integración local, independiente de Scalix.

## Uso

La búsqueda inicial usa «Closers, setters y comercial online», evidencia de español y modalidad remota o híbrida. Incluye bilingües con español mencionado. Europa es una opción de mercado; no se presupone que remoto permita trabajar desde cualquier país. La casilla de datos desconocidos no elimina el requisito explícito de español ni de modalidad.

El catálogo contiene 33 entradas (incluye categorías y una alternativa Apify para Get on Board); no representa 33 conectores directos ni todo internet.

Seis conectores públicos: Himalayas, We Work Remotely, Get on Board, Remotive, Remote OK y Arbeitnow. Los demás son rutas de integración a validar, priorizadas para España/LATAM. Un enlace a un Actor es referencia de integración, no una garantía de calidad o mantenimiento.

## Conectar una fuente

1. Fuentes → Conectar o Añadir fuente. Puedes crear varias conexiones para un portal, país o comunidad.
2. Introduce un token de Apify y un Actor ID, o un dataset existente. No se ejecuta nada al guardar.
3. Añade URLs de búsquedas, páginas o comunidades, una por línea. Selecciona el nombre de campo y formato que acepta el Actor. El formato de un solo enlace usa el primero.
4. El Input JSON contiene los criterios de captación: términos, país, remoto y límites según el Actor. La plantilla InfoJobs precarga los términos de WDC y el filtro de teletrabajo según su documentación. Los otros Actors requieren revisar Input/Output; no tienen esquemas intercambiables.
5. Adapta el mapeo de campos con una muestra de salida. Admite rutas como `company.name`. Para posts sin título omite `title`, mapea `description` al texto y `source_url` al permalink. La búsqueda requiere contratación explícita si el perfil solo aparece en la descripción.
6. Guardar → Comprobar para verificar acceso al dataset. Si necesitas nuevos datos, «Ejecutar scraper · puede generar coste» inicia exactamente una llamada POST. Comprobar actualiza el estado y recoge el dataset al terminar.
7. Oportunidades consulta el dataset guardado y aplica los filtros actuales. **Buscar no ejecuta un scraper nuevo.** No modifica dinámicamente el Input guardado del Actor.

Una respuesta incierta bloquea nuevos lanzamientos. Revisa la consola de Apify y después usa «Ya revisé Apify: desbloquear»; la app no reintenta POST de pago. Se envían límites de 90 segundos, resultados y `maxTotalChargeUsd`; la cobertura de este último depende del modelo de cargos del Actor. Los cargos reales se muestran si Apify los devuelve.

## Cobertura y límites

- Get on Board: categoría Sales, hasta tres páginas de 100. No hay nombre de empresa expandido en la respuesta consultada: se muestra «Empresa no indicada». No se infiere unidad/moneda de un importe.
- Remotive: feed cacheado seis horas conforme a su recomendación de pocas consultas al día. Ofertas retrasadas 24 horas por el proveedor; conservar atribución y enlace. Revisar sus condiciones antes de un portal público con login.
- Remote OK: ventana reciente del feed, sin historial completo.
- Arbeitnow: primera página, actualmente 250 registros; principalmente Europa, cobertura hispana variable.
- WWR: hasta 300 registros RSS. Himalayas: consultas por alias con hasta tres páginas por término; no garantiza cobertura exhaustiva.
- Apify: hasta 500 registros de cada dataset por conexión; no es importación ilimitada. HTTP JSON de proveedores distintos de Apify, OAuth y acceso privado con cookies no tienen adaptador propio todavía.
- La detección de español y modalidad es determinista y conservadora. Puede perder ofertas escuetas o ambiguas; no equivale a clasificación semántica validada. Compartir palabras con portugués no basta para declarar español. Revisar residencia, inglés, experiencia, vigencia y condiciones antes de compartir.
- No se filtra por género. La audiencia WDC son mujeres hispanas; eso no convierte las ofertas en exclusivas para mujeres.
- Grupos privados, canales y comunidades solo con acceso autorizado y un proveedor compatible. Listar una comunidad no implica que pueda extraerse anónimamente.
- Los tokens se guardan fuera de SQLite en archivos locales 0600, directorio 0700, junto a la base activa. Nunca se devuelven por API ni se guardan en localStorage. No es cifrado en reposo ni solución multiusuario de producción.
- La configuración de conexión se usa al ejecutar una búsqueda; las capturas originales permanecen inmutables. Versionar configuraciones por búsqueda queda pendiente.

## Referencias verificadas

- [API pública de Get on Board](https://www.getonbrd.com/user-manual/get-on-board-s-api)
- [Remotive: API y condiciones](https://github.com/remotive-com/remote-jobs-api)
- [Remote OK: feed y atribución](https://remoteok.com/faq)
- [Arbeitnow: API e integraciones](https://www.arbeitnow.com/blog/free-job-posting-integrations)
- [API de Apify](https://docs.apify.com/api/v2)
- [InfoJobs: Input y Output del Actor de referencia](https://apify.com/haketa/infojobs-scraper)
- [Computrabajo: Actor de referencia](https://apify.com/haketa/computrabajo-scraper)
- [LinkedIn: Actor de referencia](https://apify.com/curious_coder/linkedin-jobs-scraper)

Se verificaron públicamente los seis feeds. Los Actors de pago están documentados y probados con fixtures; no se han ejecutado con una cuenta real ni se han consumido créditos.

## Expansión documental US — 2026-09-22

La nueva investigación añade 17 fichas priorizadas en [18_US_HISPANIC_SOURCE_RESEARCH](spec/18_US_HISPANIC_SOURCE_RESEARCH.md). El catálogo ejecutable sigue con 33 entradas y seis conectores públicos; esta entrega no cambia esos recuentos ni activa scrapers.

Prioridad: ATS por empresa (Greenhouse/Lever/Ashby), recruiters LATAM→US (Remote Latinos/HireLATAM/Near), boards hispanos (Hispanic-Jobs/iHispano/DiversityJobs) y fuentes remotas/ventas/comunidades. Acceso y bloqueos documentados por ficha; sin Actors nuevos declarados operativos.

Buscar ES/EN separando US como mercado de clientes de residencia permitida. Español requerido/preferido, inglés, oficina híbrida y autorización laboral son criterios independientes. Admin conserva source/provider/raw; alumna recibe proyección centrada en empresa y condiciones con atribución necesaria.
