# Privacidad y consentimientos — borrador técnico para revisión legal

Estado: **BORRADOR**, redactado por el agente a partir de lo que la aplicación hace hoy (2026-10-18; actualizado 2026-10-25 con la actividad, la sala de práctica y los términos y condiciones). **No es asesoramiento legal.** Lo debe revisar un profesional (RGPD/LOPDGDD) antes de abrir el acceso a las alumnas. Texto público: página `/privacidad` (`apps/web/app/privacidad/page.tsx`). Versión de los consentimientos en el código: `v2-borrador` (`lib/students.ts`, `lib/applicationProfile.ts`).

## Inventario real de datos de la alumna
| Dato | Dónde se guarda | Quién lo introduce | Borrado |
| --- | --- | --- | --- |
| Email, contraseña (cifrada por Supabase Auth) | `auth.users` + `students` | invitación del panel / ella | baja (propietario) |
| Nombre, ciudad, perfiles, idiomas, disponibilidad, enlace de vídeo (solo enlace) | `student_profiles` | ella | «Borrar mi perfil»; cascada en la baja |
| Formulario base (contacto, CV por enlace, residencia, autorización de trabajo, idiomas con nivel, años, respuestas) | `student_application_profiles` | ella | «Borrar» en su espacio; cascada en la baja |
| Candidaturas preparadas y estado | `student_applications` | ella | borrado total en su espacio; cascada |
| **Actividad** (entradas, módulos repasados, nota del examen, nota y criterios de cada práctica; nunca el texto de las conversaciones) | `student_activity` (solo servidor, RLS sin políticas) | automático al usar el portal | cascada en la baja |
| **Texto de la sala de práctica** (lo que escribe/dice) | se envía a Groq para simular y puntuar; **no se guarda en nuestra base** (el historial queda en su navegador) | ella | no aplica; depende del proveedor |
| Consentimiento base (fecha, versión) y de autorrelleno (fecha, versión; hoy no se usa) | columnas `consent_*` | ella | retirable |

Aislamiento: RLS por alumna + acceso por servidor con comprobación en cada petición (probado contra la BD real; ver STATUS).

## Lo que la app NO hace (y la política lo afirma; si cambia, hay que actualizar el texto y volver a pedir consentimiento)
- No envía mensajes ni candidaturas por la alumna (ADR-012). El autorrelleno está **registrado pero inactivo**.
- No envía su **perfil, CV ni datos de contacto** a un LLM (regla de `AGENTS.md`; el matching es determinista). **Sí envía a Groq el texto que escribe en la sala de práctica**, sin nombre ni correo (corregido el 25-oct: la política decía lo contrario).
- No guarda vídeos ni CVs: solo enlaces.
- No usa cookies de publicidad/seguimiento (solo `wdc_student_at/rt` de sesión).

## Puntos que DEBE decidir o confirmar el responsable / su asesor
1. **Identidad del responsable** (razón social, NIF/CIF, dirección, email de privacidad): se rellenan con variables de entorno en Vercel `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_TAX_ID`, `LEGAL_ENTITY_ADDRESS`, `LEGAL_PRIVACY_EMAIL` (+ redeploy). Hasta entonces la página muestra «[pendiente de completar]».
2. **Base legal** de cada finalidad (¿consentimiento para todo el perfil o ejecución de la relación con la alumna?).
3. **Encargados del tratamiento**: contratos (DPA) con Supabase y Vercel y con el proveedor de correo cuando haya SMTP propio.
4. **Transferencias internacionales** (Vercel/otros): garantías aplicables.
5. **Plazos de conservación** más allá del borrado a petición (copias de seguridad, obligaciones legales).
6. **Procedimiento de derechos** (quién responde al email de privacidad y en qué plazo).
7. **Registro de actividades de tratamiento** y, si procede, evaluación de impacto.
8. **Audio y voz (futuro)**: consentimiento propio y revocable, retención definida, acuerdo de tratamiento o retención cero con el proveedor (ADR-013). No está implementado.
9. **Re-consentimiento**: al cambiar de versión, las alumnas con consentimiento anterior deberían volver a aceptar (hoy no hay alumnas con consentimiento real).
10. **Términos y condiciones** (`/terminos`, v1-borrador): ley aplicable, jurisdicción y reclamaciones; límites y exclusiones de responsabilidad; régimen de consumidoras; y si reunir y recomendar ofertas requiere algún registro (agencia de colocación).
11. **Groq (sala de práctica)**: acuerdo de tratamiento y **retención cero** antes de abrir la sala a las alumnas; hoy el texto de sus conversaciones llega al proveedor.
12. **Reconocimiento de voz del navegador**: el dictado usa el servicio de voz de su navegador (en Chrome, el de Google); decidir si la política basta o si se pide aviso en pantalla.
13. **Llamadas externas (Fathom/Plaud)** (futuro, no implementado) si se llegan a ingerir: consentimiento de todas las personas que hablan.

## Cómo se actualiza
Cambiar el texto y su versión en la misma PR: `/privacidad` → `POLICY_VERSION`; `/terminos` → `TERMS_VERSION` (ambas en `lib/legal.ts`); el texto de la casilla de consentimiento del perfil → `CONSENT_VERSION` (`lib/students.ts`); el de autorrelleno → `AUTOFILL_CONSENT_VERSION` y anotarlo en `docs/STATUS.md`.
