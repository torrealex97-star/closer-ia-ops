// Datos del responsable del tratamiento: los pone el propietario por variables de entorno (Vercel). Mientras falten, la política
// los muestra como «pendiente de completar»: no se inventa ninguna razón social, CIF ni dirección.
const pending = '[pendiente de completar]';
export const legalEntity = () => ({
  name: process.env.LEGAL_ENTITY_NAME?.trim() || pending,
  taxId: process.env.LEGAL_ENTITY_TAX_ID?.trim() || pending,
  address: process.env.LEGAL_ENTITY_ADDRESS?.trim() || pending,
  email: process.env.LEGAL_PRIVACY_EMAIL?.trim() || pending,
});
export const POLICY_VERSION = 'v2-borrador', POLICY_DATE = '2026-10-18';
