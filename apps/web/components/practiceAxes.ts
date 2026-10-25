// Etiquetas de los ejes de la rúbrica de práctica. Son las mismas que muestra el
// feedback; viven aparte de los prompts (servidor) porque el panel de progreso
// las pinta para la alumna y para la coordinadora.
export const PRACTICE_AXIS_LABELS: Record<string, string> = {
  apertura: 'Apertura y marco',
  descubrimiento: 'Descubrimiento',
  objecion: 'Objeciones',
  cierre: 'Cierre',
  claridad: 'Claridad',
  evidencia: 'Evidencia y cifras',
  iniciativa: 'Cierre e iniciativa',
  confianza: 'Confianza y autoridad',
  encaje: 'Encaje',
};

export const PRACTICE_AXIS_IDS = Object.keys(PRACTICE_AXIS_LABELS);

// Referencia semanal para la alumna (no es una cuota de la coordinadora): da
// una respuesta concreta a «¿cómo voy?» sin convertirla en una nota.
export const WEEK_GOAL = 3;

export const practiceKindLabel = (value: unknown) => value === 'entrevista' ? 'Entrevista' : value === 'venta' ? 'Venta' : '';
