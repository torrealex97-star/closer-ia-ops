// Módulos de Formación que se registran como «repasados» en el progreso de la alumna. Fichero sin dependencias de
// servidor: lo importan tanto el navegador (panel de progreso) como la API (validación).
export const REVIEW_REFS = ['precall', 'logica', 'freezing', 'yellows', 'star', 'cierres', 'descubrimiento'] as const;
export type ReviewRef = (typeof REVIEW_REFS)[number];
