# ADR-014 — Métricas de alumnas y gamificación deterministas; correo entrante con Resend (solo diseño)

Estado: aceptada (métricas, implementadas) · propuesta (correo entrante, **no implementado**) · Fecha: 2026-10-25 · Evidencia: *tested* en servicios simulados; la migración no está aplicada ni verificada contra Supabase real.

## Contexto
El dueño aportó una propuesta de arquitectura para llevar a las closers de nivel cero a proyectos de alto valor en 90 días: roleplay por voz, entrevistas, scraper y candidaturas, correo entrante, créditos y gamificación. Se contrastó con lo que ya existe y con las decisiones registradas (ADR-007, ADR-012, ADR-013). Este ADR fija las **métricas** (lo que se puede construir ya, sin gasto) y deja **diseñado, sin construir**, el correo entrante.

## Decisión 1 — Las métricas se derivan, no se almacenan
Definidas en [`apps/web/lib/studentMetrics.ts`](../../apps/web/lib/studentMetrics.ts) y [`studentDashboard.ts`](../../apps/web/lib/studentDashboard.ts); la interfaz no las redefine.
- **XP y nivel**: suma derivada de la actividad y de las candidaturas (días de entrada ×5, módulos repasados ×20 una vez, examen superado +100, prácticas 10 + nota/10 con **máximo 3 por día**, candidaturas por estado: enviada 15, respondida 40, entrevista 90, oferta 190, respuesta negativa 40). Ocho niveles. No hay tabla de XP que se pueda inflar y un borrador no puntúa. Una respuesta negativa **no se penaliza**.
- **Maestría por escenario**: media y mejor nota de las prácticas por escenario (los escenarios aún no tienen nicho; cuando lo tengan se agrupará por nicho).
- **Tasa de respuesta** = candidaturas con respuesta / enviadas; sin enviadas es «—». **Medida solo en la parte declarada**: hoy la anota la alumna.
- **Retención** a 30 y 90 días: de las alumnas con acceso y alta anterior al corte, las que han entrado o practicado en el periodo cargado (30 o 90 días; con 7 no se calcula).
- **Candidata a derivar** (sugerencia con reglas a la vista): examen superado, ≥ 3 prácticas con nota media ≥ 70 y ≥ 3 candidaturas enviadas. Es una ayuda para la coordinadora, no una evaluación de la alumna.
- Un hueco no es un cero: si no se pueden leer las candidaturas o la actividad, se declara (`null` / «—»).

## Decisión 2 — Resultado de cada candidatura, declarado por la alumna
La migración `20261025_application_outcomes.sql` (**no aplicada**) amplía el estado de `student_applications` con `responded`, `interview`, `offer` y `rejected`. Solo toca el `CHECK`: no añade columnas, así que el código desplegado antes de la migración no rompe lecturas; anotar un resultado devuelve un mensaje honesto hasta que se aplique. No se mide el tiempo hasta la respuesta (haría falta una columna nueva).

## Decisión 3 — Correo entrante con Resend (diseño; no se construye aún)
El dueño eligió **Resend** (no Mailgun ni SendGrid). Para detectar respuestas de empresas sin que la alumna lo anote:
- Una dirección de reenvío por alumna en un subdominio de la academia, enlazada a su `user_id`.
- Un webhook que **verifica la firma**, deduplica por id de mensaje y solo actualiza el estado de la candidatura correspondiente; guarda remitente y asunto mínimos, **no el cuerpo**, salvo decisión posterior.
- Clave y secreto del webhook solo en variables de entorno; coste y proveedor opt-in.
- **Antes de construir**: (a) ~~comprobar en la documentación de Resend que ofrece recepción de correo con webhook y su precio~~ — **comprobado el 2026-10-26 (nivel *inspected*: resultados de búsqueda de su documentación; no se pudo abrir resend.com desde el entorno ni se ha probado con una cuenta)**: Resend ofrece recepción (`email.received`) con una dirección `.resend.app` propia o con dominio propio; el webhook trae `email_id`, `from`, `to`, `subject` y solo **metadatos** de adjuntos (el cuerpo y el contenido se piden después a su API de recepción); guarda los correos aunque el webhook falle. El plan gratuito declara 3.000 correos al mes y 100 al día, y los recibidos **cuentan en la misma cuota** que los enviados (Pro: 20 USD al mes por 50.000). **Sin verificar**: la firma del webhook, los límites de tamaño y el precio exacto vigente (míralo en resend.com/pricing); (b) texto de consentimiento propio y revocable, porque llegan datos personales de terceros (el contacto de la empresa); (c) dominio y DNS por el dueño; (d) tratar el contenido como dato no confiable (inyección).
- La app **no envía** correos a las empresas por esta vía: solo recibe.

## Fuera de alcance (decisión del dueño o pendiente de él)
- **Candidaturas automáticas / Playwright / Camoufox**: se mantiene lo **asistido** (ADR-012). Un navegador anti-detección no se usará; cualquier automatización exige autorización escrita y las condiciones del ADR-012.
- **Voz y WebRTC**: ADR-013 (acuerdo de tratamiento de datos, retención cero, texto legal de audio).
- **Peer-to-peer y créditos de minutos**: requieren sesión de alumna (login aún apagado) y consentimiento mutuo.
- **Auditoría de llamadas con Fathom**: grabaciones de terceros; consentimiento primero.
- **«+2.000 €/mes en 90 días»**: no se muestra en la app como promesa ni garantía; cualquier cifra de resultados pasa por el dueño y su asesor.

## Consecuencias
La alumna ve su nivel y cómo se calcula, y la coordinadora ve respuesta de empresas, retención y candidatas a derivar. Todo es explicable y reproducible desde los datos. Mientras la migración de actividad (`student_activity`) y la de resultados no se apliquen, el progreso no se guarda y los resultados no se pueden anotar: la interfaz lo dice.
