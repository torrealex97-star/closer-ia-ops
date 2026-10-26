# Seguridad

Este repositorio es público. **No hay ningún secreto en él**: las claves viven en variables de entorno de Vercel o cifradas en Panel → APIs, y los datos de alumnas solo en Supabase (con RLS).

Si encuentras una vulnerabilidad o una clave expuesta, **no abras una incidencia pública**: escribe al responsable por el canal privado que figure en `/privacidad` (variable `LEGAL_PRIVACY_EMAIL`) o usa «Report a vulnerability» en la pestaña *Security* de GitHub. Si una clave se ha expuesto, hay que **rotarla** en su proveedor, no solo borrarla del historial.

Controles que ya existen: CI con `tests/secrets.mjs` (rechaza claves reconocibles en ficheros versionados), RLS sin políticas públicas en las tablas de alumnas, claves cifradas con `ADMIN_SECRETS_KEY`, y la sala de práctica y las candidaturas sin envíos automáticos.
