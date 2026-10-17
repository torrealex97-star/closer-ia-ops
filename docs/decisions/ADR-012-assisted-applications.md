# ADR-012 — Candidaturas asistidas hoy, automatizables mañana (sin activarlo)

Estado: aceptada (parte asistida, implementada en 3.2) · propuesta (parte automática, **no implementada**) · Fecha: 2026-10-17

## Contexto
Las alumnas aplican a ofertas rellenando formularios distintos que piden casi lo mismo. El dueño quiere que hoy **ellas** completen un primer formulario con todo, revisen y envíen; y que **en el futuro** una IA/automatización pueda completarlo por ellas.

## Decisión
1. **Fuente única de datos:** `student_application_profiles` (formulario base) + `student_profiles` (nombre, ciudad, vídeo) son el único sitio con los datos para rellenar formularios. Cualquier automatización futura leerá de aquí; no habrá copias.
2. **Hoy, asistido:** la app genera un borrador **determinista** (sin IA) y una lista de datos para copiar; la alumna revisa, copia y envía **ella** en la web de la empresa. La app solo anota estado (`draft → opened → applied → discarded`). No hay ninguna ruta que envíe correos, rellene formularios ajenos ni contacte con empresas.
3. **Consentimiento de autorrelleno aparte** (`autofill_consent_at/version`): explícito, fechado, versionado y **retirable**; separado del consentimiento base. Hoy se guarda pero **nada lo consume**.
4. **Vídeo y CV son enlaces** a su propio Drive; no se guardan ficheros.
5. **Datos de la alumna nunca a un LLM** sin acuerdo de tratamiento y retención cero (regla de AGENTS.md). La IA futura, si se usa para redactar, recibe solo lo mínimo, nunca el formulario completo, y se evalúa antes (golden set).

## Condiciones para pasar a automático (NO cumplidas; requieren autorización escrita del propietario y cambio de AGENTS.md)
- Canales permitidos únicamente: correo desde el dominio de la academia y formularios públicos de empresas **que lo permitan** (términos revisados por fuente). **Nunca** redes sociales, cuentas personales ni cookies/tokens de terceros.
- Por alumna: consentimiento de autorrelleno vigente + **aprobación por candidatura** (vista previa del diff real, no del resumen del modelo) al principio; automatismo sin aprobación solo tras un periodo medido y con permiso explícito.
- Topes (por día/semana/empresa), registro de auditoría de cada acción, posibilidad de deshacer/retirar, y **claim atómico** antes de cada envío (`UPDATE … WHERE status='draft'` y seguir solo si la fila es nuestra) para no enviar dos veces.
- Worker fuera de Vercel (límites de tiempo), con secretos solo en variables de entorno/cifrado; contenido de la oferta tratado como dato no confiable (inyección).
- Lista de empresas/ATS permitidos y mapeo de campos versionado; si un campo no se reconoce, se pregunta a la alumna (ante la duda, encola).
- Evals con conjunto dorado y umbrales de bloqueo antes de activar; kill-switch inmediato.

## Consecuencias
La 3.2 ya recoge los datos en el formato que una automatización necesitaría (campos tipados, enumeraciones, enlaces https, respuestas por clave) sin construir nada de la automatización. Activarla es una fase aparte (Fase 4) con su ADR de aprobación.
