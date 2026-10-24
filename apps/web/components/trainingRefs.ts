// Módulos de Formación que se registran como «repasados» en el progreso de la alumna. Fichero sin dependencias de
// servidor (se amplía cuando se añade un módulo a la Formación): lo importan tanto el navegador (panel de progreso) como la API (validación).
export const REVIEW_REFS = ['precall', 'logica', 'freezing', 'yellows', 'star'] as const;
export type ReviewRef = (typeof REVIEW_REFS)[number];
