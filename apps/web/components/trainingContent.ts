// Contenido de la formación. Portado del paquete anterior (metodología WDC) y
// adaptado: aquí no hay proveedor de IA ni claves en el navegador. Los ejercicios
// se revisan con reglas sobre el texto (trainingCheck) y el examen es determinista.
// Las cifras del ejercicio de Venta Lógica son ficticias y se rotulan como tales.

export type TrainingId = 'precall' | 'logica' | 'descubrimiento' | 'freezing' | 'yellows' | 'star' | 'cierres' | 'certificacion';

export type TrainingModule = {
  id: TrainingId;
  title: string;
  summary: string;
  tag: string;
  minutes: number;
};

export const TRAINING_MODULES: TrainingModule[] = [
  {
    id: 'precall',
    title: 'Pre-llamada y show-rate',
    summary: 'Escribe la secuencia de confirmación: razones para asistir, presentación, vídeo, prueba social y última confirmación.',
    tag: 'Antes de la llamada',
    minutes: 12,
  },
  {
    id: 'logica',
    title: 'Venta lógica',
    summary: 'Calcula la brecha y el coste de seguir igual con las cifras que te da la clienta, y suelta el número sin rellenar el silencio.',
    tag: 'Coste de inacción',
    minutes: 10,
  },
  {
    id: 'freezing',
    title: 'Anti-freezing',
    summary: 'Cinco ataques al ego y silencios incómodos. Practicas aceptar, validar y volver a preguntar sin defenderte.',
    tag: 'Presión',
    minutes: 10,
  },
  {
    id: 'yellows',
    title: 'Yellows are golds',
    summary: 'Leads que mienten, contestan con una palabra o intentan colgar. Aprendes a sacar información o a descalificar.',
    tag: 'Leads difíciles',
    minutes: 10,
  },
  {
    id: 'star',
    title: 'Calificación STAR',
    summary: 'Situación, timing, autoridad y recursos antes de cerrar. Sin los cuatro, la objeción no es de cierre.',
    tag: 'Antes de cerrar',
    minutes: 6,
  },
  {
    id: 'descubrimiento',
    title: 'Los nueve pasos de descubrimiento',
    summary: 'La secuencia para llegar al dolor real antes de hablar de la solución: situación, deseo, obstáculo, razón, detalle, resumen, etiqueta, confirmación y repetición.',
    tag: 'Conversación',
    minutes: 12,
  },
  {
    id: 'cierres',
    title: 'Los diez cierres exactos',
    summary: 'Qué decir cuando la decisión está cerca: diez cierres con su fórmula, cuándo usarlos y el concepto que los sostiene.',
    tag: 'Repertorio',
    minutes: 12,
  },
  {
    id: 'certificacion',
    title: 'Ruta de cuatro semanas',
    summary: 'Fundamentos, descubrimiento, cierre y alta presión con sus entregables, más el examen de egreso.',
    tag: 'Ruta completa',
    minutes: 15,
  },
];

export const moduleById = (id: string) => TRAINING_MODULES.find(item => item.id === id) ?? null;

// ---- Módulo 1: pre-llamada -------------------------------------------------

export type PreCallStep = {
  id: string;
  timing: string;
  channel: string;
  objective: string;
  exampleGood: string;
  exampleBad: string;
};

export const PRE_CALL_STEPS: PreCallStep[] = [
  {
    id: 'inmediato',
    timing: 'Inmediato tras agendar',
    channel: 'SMS o WhatsApp con material preparatorio',
    objective: 'Confirmar la cita y vender la llamada con tres razones de peso para asistir.',
    exampleGood:
      '¡Cita confirmada! Martes 15:00. Tres cosas para que aproveches nuestra llamada: 1) Veremos exactamente por qué no estás cerrando más. 2) Te daré un plan concreto. 3) Saldrás sabiendo tu siguiente paso. Guarda este enlace con la tarea preparatoria.',
    exampleBad: 'Hola, tu cita es el martes a las 15:00. Nos vemos entonces.',
  },
  {
    id: '5min',
    timing: 'Cinco minutos después',
    channel: 'WhatsApp',
    objective: 'Humanizar la relación: que vea que hay una persona real detrás.',
    exampleGood:
      'Soy Ana, la persona con la que vas a hablar el martes. Quería presentarme y decirte que me alegro de que hayas dado el paso. Si tienes dudas antes de la llamada, escríbeme por aquí.',
    exampleBad: 'Recordatorio: tienes una cita el martes.',
  },
  {
    id: 'noche-anterior',
    timing: 'Noche anterior',
    channel: 'Vídeo corto por WhatsApp',
    objective: 'Construir conexión humana y compromiso con un vídeo personal y breve.',
    exampleGood:
      '¡Hola Marta! Mañana a las 15:00 nos vemos. Quería mandarte este vídeo rápido para que sepas que estoy preparando nuestra sesión a medida para ti. He visto tu caso y tengo ideas concretas. ¡Hasta mañana!',
    exampleBad: 'No olvides tu cita de mañana a las 15:00.',
  },
  {
    id: 'manana',
    timing: 'Mañana de la cita',
    channel: 'WhatsApp con prueba social',
    objective: 'Sembrar la solución a una objeción futura con un caso relevante.',
    exampleGood:
      'Te dejo este caso de una alumna que empezó exactamente donde tú estás ahora. En tres semanas cerró su primera venta de 3.000 €. Mañana te cuento cómo lo hizo.',
    exampleBad: 'Te envío el testimonio de una alumna. Nos vemos a las 15:00.',
  },
  {
    id: '1h',
    timing: 'Una hora antes',
    channel: 'SMS o WhatsApp',
    objective: 'Confirmar logística y reducir las ausencias de última hora.',
    exampleGood: 'Nos vemos en una hora. ¿Te viene mejor el enlace de Zoom o el de Meet? Confírmame y te lo paso ahora mismo.',
    exampleBad: 'Tu cita es en una hora.',
  },
  {
    id: '15min',
    timing: 'Quince minutos antes',
    channel: 'SMS',
    objective: 'Última confirmación con el enlace y salida digna si algo ha surgido.',
    exampleGood:
      'Entrando a la sala. Te paso el enlace: https://ejemplo.test/sala. Si algo surgió, avísame y reprogramamos; si estás lista, nos vemos en cinco minutos.',
    exampleBad: 'La cita es en quince minutos.',
  },
];

export const SHOW_RATE_RULES: string[] = [
  'Cita a 24 horas: la asistencia sube mucho. Cita a siete días: la mitad se cae.',
  'Agenda entre uno y dos días desde el agendamiento, nunca más.',
  'Vende la llamada en el primer mensaje: tres razones concretas para asistir.',
  'Martillo de terciopelo: política de cancelación clara a mediodía del día de la cita.',
  'Si no responde, el re-enganche es una pregunta: «¿hacia dónde deberíamos ir desde aquí?».',
  'Manda material que mate objeciones antes de la llamada (venta por asignación).',
  'Siembra la objeción de pareja o de dinero antes de dar el precio.',
];

// ---- Módulo 2: venta lógica ------------------------------------------------

export const LOGICA = {
  // Datos ficticios del ejercicio, no de una persona real.
  client: { name: 'Cliente ficticia', age: 34, goal: '5.000 € al mes de ingreso pasivo' },
  figures: { meta: 5000, ingresoActual: 1800, ahorroMensual: 200, horizonteAnos: 5 },
  expected: { brecha: 3200, coste: 192000, mesesDeAhorro: 16 },
  disyuntiva:
    'Tienes dos caminos. Uno: seguir como ahora, ahorrando 200 € al mes, y dentro de cinco años seguir en 1.800 €. Dos: poner un sistema y cerrar la brecha de 3.200 € al mes. En cinco años, la diferencia entre los dos caminos son 192.000 €.',
  silenceRule:
    'Después de soltar el número, no hables. Ni «¿qué te parece?» ni «¿cómo lo ves?». Quien habla primero después del precio, pierde.',
  closeExample:
    'Tú decides: seguir igual o empezar. Lo que no puedes es seguir diciendo que quieres 5.000 € al mes y no cambiar nada.',
  task: 'Haz el cálculo en voz alta con una persona real y después cállate diez segundos. Repítelo tres veces esta semana.',
};

// ---- Módulo 3: anti-freezing -----------------------------------------------

export const FREEZING = {
  attacks: [
    'Vale, pero sinceramente: esto me suena a vendehumos. ¿Y tú qué me vas a contar?',
    '¿En serio? O sea que me llamas para venderme humo con una sonrisa.',
    'A ver, ni siquiera sabes cuánto facturo yo. ¿Cómo vas a saber lo que necesito?',
    'Me estás diciendo que no sé llevar mi negocio. Eso es lo que estás diciendo.',
    'Mira, se me han quitado las ganas. Creo que esta llamada no tiene sentido.',
  ],
  protocol: [
    'Aceptar: «Tienes razón» o «De acuerdo contigo».',
    'Validar: «Es razonable que sientas eso».',
    'Looping: «Y al mismo tiempo, lo que también es cierto es que…».',
    'Bajar la velocidad de la voz a propósito.',
    'No defenderte, no justificarte, no explicar que eres buena.',
  ],
  rule: 'El ataque al ego no se responde con argumentos. Se responde bajando el ritmo y devolviendo una pregunta.',
  reactivation: [
    'El miedo no significa que no puedas: significa que estás en el borde de tu zona de confort.',
    'Cada closer que admiras fue rechazada muchas veces antes de su primera venta. La diferencia no es el talento: es cuántas veces vuelve después de un no.',
    'Si has bajado la moral en este ejercicio, para y respira. El ataque es del personaje, no de la persona que tienes delante en la vida real.',
  ],
};

// ---- Módulo 4: yellows -----------------------------------------------------

export type YellowLead = {
  id: string;
  name: string;
  behavior: string;
  challenge: string;
  opening: string;
  replies: string[];
};

export const YELLOW_LEADS: YellowLead[] = [
  {
    id: 'mentiroso',
    name: 'El mentiroso',
    behavior: 'Miente sobre su situación, sus ingresos o su autoridad. Todo suena bien y nada es comprobable.',
    challenge: 'Detectar la mentira con preguntas de verificación y no avanzar la venta.',
    opening: 'Hola, te escucho. ¿De qué se trata?',
    replies: ['Sí, gano 20.000 € al mes.', 'Claro, tengo un equipo de quince personas.', 'Ya he hecho cursos antes y todos me sirvieron.'],
  },
  {
    id: 'una-palabra',
    name: 'Respuestas de una palabra',
    behavior: 'Contesta «sí», «no», «vale», «igual». No da información.',
    challenge: 'Sacar información real con preguntas abiertas o descalificar al lead.',
    opening: 'Hola, te escucho. ¿De qué se trata?',
    replies: ['Sí.', 'No.', 'Vale.', 'Igual.'],
  },
  {
    id: 'cuelga',
    name: 'El que cuelga',
    behavior: 'Intenta colgar en los primeros treinta segundos con excusas.',
    challenge: 'Sostener el marco con un gancho de curiosidad en los primeros quince segundos.',
    opening: 'Hola, te escucho. ¿De qué se trata?',
    replies: ['Tengo una reunión ahora, llámame otro día.', 'No tengo tiempo, envíamelo por WhatsApp.', 'Ahora no puedo hablar.'],
  },
];

export const YELLOW_RULE =
  'Un lead que no da información no es un cliente: es un hueco en la agenda. Se intenta abrir con preguntas concretas y, si sigue cerrado, se descalifica sin dramatismo.';

// ---- Módulo 5: STAR --------------------------------------------------------

export const STAR_CRITERIA = [
  {
    letter: 'S',
    name: 'Situación',
    question: '¿Tiene un problema que esto puede resolver?',
    description: 'Verifica que el problema es real y que el servicio lo toca.',
  },
  {
    letter: 'T',
    name: 'Timing',
    question: '¿Tiene una razón para actuar ahora y no en seis meses?',
    description: 'Sin urgencia propia, el cierre se convierte en seguimiento eterno.',
  },
  {
    letter: 'A',
    name: 'Autoridad',
    question: '¿Puede decir que sí sin consultar a nadie?',
    description: 'Si no decide, estás cualificando a un mensajero.',
  },
  {
    letter: 'R',
    name: 'Recursos',
    question: '¿Tiene el dinero y el tiempo para hacerlo?',
    description: 'Confirma que puede pagar y comprometerse, sin inventar cifras por ella.',
  },
];

export const STAR_RULE =
  'Sin STAR, la objeción es un problema de calificación, no de cierre. Si intentas cerrar a un lead sin calificar, la objeción que recibas no será la real: será el síntoma de que preguntaste tarde.';

// ---- Módulo 6: descubrimiento ----------------------------------------------

// Los nueve pasos del descubrimiento, en orden. Son una secuencia de preguntas,
// no un guion para recitar: cada paso existe para que el siguiente tenga sentido.
export type DiscoveryStep = {
  step: number;
  name: string;
  description: string;
  technique: string;
  example: string;
};

export const DISCOVERY_STEPS: DiscoveryStep[] = [
  {
    step: 1,
    name: 'Situación',
    description: 'Entender dónde está la clienta hoy, con sus palabras.',
    technique: 'Pregunta abierta sobre su contexto actual; nada de supuestos.',
    example: '«¿Cómo está tu negocio ahora mismo?»',
  },
  {
    step: 2,
    name: 'Deseo',
    description: 'Descubrir qué quiere lograr, en su medida y su plazo.',
    technique: 'Pregunta por la meta ideal, sin sugerirla tú.',
    example: '«¿A dónde quieres llegar en los próximos doce meses?»',
  },
  {
    step: 3,
    name: 'Obstáculo',
    description: 'Identificar qué le impide llegar, no qué te conviene que diga.',
    technique: 'Preguntar directamente por la barrera.',
    example: '«¿Qué crees que te impide llegar ahí hoy?»',
  },
  {
    step: 4,
    name: 'Razón',
    description: 'Entender por qué eso importa: el motivo real, no el de la web.',
    technique: 'Profundizar en la motivación emocional sin forzarla.',
    example: '«¿Por qué es importante para ti lograr eso?»',
  },
  {
    step: 5,
    name: 'Detalle',
    description: 'Hacer que la clienta articule el dolor con un caso concreto.',
    technique: 'Pedir un ejemplo: lo específico se puede trabajar, lo genérico no.',
    example: '«¿Puedes darme un ejemplo concreto de cuándo te pasó?»',
  },
  {
    step: 6,
    name: 'Resumen',
    description: 'Devolver lo escuchado con tus palabras, sin adornarlo.',
    technique: 'Repetir meta, obstáculo y consecuencia en una frase.',
    example: '«Déjame ver si lo entiendo: quieres X, pero Y te lo impide, y si no lo resuelves, Z sigue igual.»',
  },
  {
    step: 7,
    name: 'Etiqueta',
    description: 'Nombrar lo que siente, sin psicoanalizar ni consolar.',
    technique: 'Etiquetar la emoción con una frase corta y comprobarla.',
    example: '«Suena como que te sientes frustrada con tu situación actual.»',
  },
  {
    step: 8,
    name: 'Confirmación',
    description: 'Confirmar que el resumen es correcto antes de avanzar.',
    technique: 'Preguntar si falta algo; dejar que corrija.',
    example: '«¿Es eso correcto? ¿Me dejo algo?»',
  },
  {
    step: 9,
    name: 'Repetición',
    description: 'Si aparece una capa nueva de dolor, volver a empezar con ella.',
    technique: 'No dar por cerrado el descubrimiento por haber hecho las preguntas.',
    example: '«¿Hay algo más que no has mencionado todavía?»',
  },
];

// Banco de preguntas: un ejemplo por paso, con cuatro opciones. Se corrige por
// clave, igual que el examen, sin modelo de lenguaje.
export type TrainingQuizItem = { id: string; prompt: string; answer: string; options: string[] };

export const DISCOVERY_QUIZ: TrainingQuizItem[] = [
  {
    id: 'situacion',
    prompt: '«¿Cómo está tu negocio ahora mismo?»   ¿Qué paso es?',
    answer: '1',
    options: ['1', '2', '3', '4'],
  },
  {
    id: 'obstaculo',
    prompt: '«¿Qué crees que te impide llegar ahí hoy?»   ¿Qué paso es?',
    answer: '3',
    options: ['2', '3', '4', '5'],
  },
  {
    id: 'resumen',
    prompt: '«Déjame ver si lo entiendo: quieres X, pero Y te lo impide, y si no lo resuelves, Z sigue igual.»   ¿Qué paso es?',
    answer: '6',
    options: ['4', '5', '6', '7'],
  },
  {
    id: 'etiqueta',
    prompt: '«Suena como que te sientes frustrada con tu situación.»   ¿Qué paso es?',
    answer: '7',
    options: ['5', '6', '7', '8'],
  },
  {
    id: 'repeticion',
    prompt: 'Ya resumiste y ella lo confirmó, pero aparece una capa nueva de dolor. ¿Qué toca?',
    answer: '9',
    options: ['8', '9', '6', '1'],
  },
];

// ---- Módulo 7: los diez cierres exactos -----------------------------------

// Cierres con nombre propio. Los ejemplos llevan [importe] y [plazo] en lugar de
// cifras: se dice el precio real de la oferta, nunca uno inventado por la app.
export type ExactClose = {
  id: string;
  name: string;
  gloss: string;
  when: string;
  formula: string;
  example: string;
  concept: string;
};

export const EXACT_CLOSES: ExactClose[] = [
  {
    id: 'decadere',
    name: 'Decadere',
    gloss: 'decidir es cortar opciones',
    when: 'Cuando la clienta ya superó las tres capas de objeciones y todo está claro.',
    formula: 'Presentar el precio como algo ya decidido, nunca como una pregunta.',
    example: '«El programa son [importe]. El proceso de inscripción te lo envío ahora mismo.»',
    concept: 'El precio se afirma; no se pide permiso. La certeza de quien vende se transfiere a quien compra.',
  },
  {
    id: 'closer-or-further',
    name: 'Closer or Further',
    gloss: '¿nos acerca o nos aleja?',
    when: 'Cuando la conversación da vueltas y evita la decisión.',
    formula: 'Preguntar si lo hablado acerca o aleja de decidir.',
    example: '«¿Esta conversación nos acerca a que empieces hoy, o nos aleja?»',
    concept: 'Obliga a reconocer si se avanza o se escapa, sin acusar a nadie.',
  },
  {
    id: 'six-inches',
    name: 'Six Inches From Gold',
    gloss: 'a un paso del oro',
    when: 'Cuando duda justo en el último momento.',
    formula: 'Recordar que está más cerca de lo que cree.',
    example: '«Estás a un paso de lo que querías. Lo único que falta es decidirlo.»',
    concept: 'La distancia percibida frena más que la distancia real.',
  },
  {
    id: 'support-not-permission',
    name: 'Support, Not Permission',
    gloss: 'apoyo, no permiso',
    when: 'Cuando invoca a la pareja, a un socio o a su equipo.',
    formula: 'Reencuadrar «necesito permiso» como «necesito apoyo».',
    example: '«No necesitas permiso de tu pareja: necesitas su apoyo. Y para tenerlo, primero necesitas estar segura tú.»',
    concept: 'Cambiar el marco devuelve la decisión a quien la está tomando.',
  },
  {
    id: 'good-its-a-lot',
    name: "It's Good That It's a Lot",
    gloss: 'que sea mucho es buena señal',
    when: 'Cuando dice «es mucho dinero».',
    formula: 'Reencuadrar el precio alto como prueba de valor.',
    example: '«Es bueno que sea mucho: si costara una décima parte, no te daría este resultado. El precio refleja el valor.»',
    concept: 'El precio alto es una característica del servicio, no un defecto que haya que disculpar.',
  },
  {
    id: 'some-now-more-later',
    name: 'Some Now or More Later',
    gloss: 'empezar hoy o pagar más tarde',
    when: 'Cuando no puede pagar todo de golpe.',
    formula: 'Ofrecer empezar con una parte ahora y el resto después.',
    example: '«Puedes empezar ahora con el primer módulo y sumar el resto el próximo mes, o pagar todo ahora y ahorrar. ¿Cuál prefieres?»',
    concept: 'Dos caminos que llevan a empezar; ninguno lleva a desaparecer.',
  },
  {
    id: 'dont-burn-twice',
    name: "Don't Let It Burn You Twice",
    gloss: 'no te quemes dos veces',
    when: 'Cuando ya lo intentó antes y le fue mal.',
    formula: 'Usar el dolor de la experiencia pasada como razón para no repetirla.',
    example: '«Ya te quemaste una vez sin acompañamiento. No dejes que te queme dos veces: esta vez vas a tener soporte real.»',
    concept: 'El dolor pasado no se ignora ni se dramatiza: se usa para decidir distinto.',
  },
  {
    id: '1-10-close',
    name: '1-10 Close',
    gloss: 'del 1 al 10',
    when: 'Para medir el interés real antes de seguir invirtiendo tiempo.',
    formula: 'Pedir una nota del 1 al 10 y trabajar el número.',
    example: '«Del 1 al 10, ¿dónde estás ahora mismo con esto? Si estás por debajo de 7, te digo que no es para ti.»',
    concept: 'El número revela la objeción escondida: un 5 es una duda, un 8 es una decisión.',
  },
  {
    id: 'nervousness-close',
    name: 'Nervousness Close',
    gloss: 'los nervios son señal de importancia',
    when: 'Cuando confiesa nervios o miedo a decidir.',
    formula: 'Normalizar los nervios como señal de que la decisión importa.',
    example: '«Es normal estar nerviosa: significa que esto te importa de verdad. Lo que no importa no da nervios.»',
    concept: 'Los nervios no piden parar; piden acompañamiento.',
  },
  {
    id: 'mechanic-close',
    name: 'Mechanic / Surgeon Secretary Close',
    gloss: 'enseñar el mecanismo',
    when: 'Cuando la clienta es analítica y necesita entender el sistema antes de pagar.',
    formula: 'Explicar el mecanismo exacto, paso por paso.',
    example: '«Te explico el mecanismo exacto: [plazo] hacemos X, después Y, y medimos Z. Es un sistema, no improvisación.»',
    concept: 'Quien compra con datos no compra promesas: compra un mecanismo que puede seguir.',
  },
];

// Cuatro situaciones reales de llamada y cuatro cierres posibles. Se corrige por
// clave: cada situación admite un cierre del método, no una respuesta «bonita».
export const CLOSE_QUIZ: TrainingQuizItem[] = [
  {
    id: 'decidida',
    prompt: 'La clienta ya pasó las tres capas de objeciones y todo está claro. ¿Qué cierre pide la situación?',
    answer: 'decadere',
    options: ['decadere', 'six-inches', '1-10-close', 'nervousness-close'],
  },
  {
    id: 'pareja',
    prompt: 'Dice que necesita hablarlo con su pareja antes de decidir. ¿Qué cierre pide la situación?',
    answer: 'support-not-permission',
    options: ['support-not-permission', 'good-its-a-lot', 'closer-or-further', 'mechanic-close'],
  },
  {
    id: 'divaga',
    prompt: 'Lleva veinte minutos dando vueltas y no pide el siguiente paso. ¿Qué cierre pide la situación?',
    answer: 'closer-or-further',
    options: ['closer-or-further', 'dont-burn-twice', 'some-now-more-later', 'six-inches'],
  },
  {
    id: 'nervios',
    prompt: 'Se le nota el miedo a equivocarse justo antes de decidir. ¿Qué cierre pide la situación?',
    answer: 'nervousness-close',
    options: ['nervousness-close', 'good-its-a-lot', 'decadere', '1-10-close'],
  },
  {
    id: 'analitica',
    prompt: 'Quiere entender el sistema exacto antes de pagar y no compra promesas. ¿Qué cierre pide la situación?',
    answer: 'mechanic-close',
    options: ['mechanic-close', 'support-not-permission', 'some-now-more-later', 'dont-burn-twice'],
  },
];

// ---- Módulo 8: ruta y examen -----------------------------------------------

export const CERTIFICATION_WEEKS = [
  {
    week: 1,
    title: 'Fundamentos e identidad',
    focus: 'Identidad de closer, tono de igual a igual, pre-llamada y show-rate.',
    deliverables: ['Escribir la secuencia completa de pre-llamada', 'Aprobar el criterio de no sumisión', 'Grabar una presentación de sesenta segundos'],
    minScore: 80,
  },
  {
    week: 2,
    title: 'Descubrimiento y brecha',
    focus: 'Preguntas de situación, dolor, brecha y coste de inacción.',
    deliverables: ['Hacer el cálculo de coste de inacción sin ayuda', 'Preguntar antes de presentar', 'Sostener el silencio tras el número'],
    minScore: 80,
  },
  {
    week: 3,
    title: 'Cierre y looping',
    focus: 'Aceptar, validar, reencuadrar y volver a pedir la venta sin «pero».',
    deliverables: ['Aceptar una objeción sin defenderse', 'Reencuadrar con «y al mismo tiempo»', 'Volver a pedir una decisión pequeña'],
    minScore: 80,
  },
  {
    week: 4,
    title: 'Alta presión y examen',
    focus: 'Ataques al ego, leads difíciles y examen de egreso.',
    deliverables: ['Sostener cinco ataques sin defenderte', 'Trabajar los tres leads difíciles', 'Aprobar el examen de egreso'],
    minScore: 85,
  },
];

export const BELIEF_LADDER = [
  {
    id: 'vehiculo',
    level: 'Escalón 1: el vehículo',
    belief: 'No cree en el método.',
    symptom: '¿Eso funciona de verdad? ¿No es como los demás cursos?',
    script: 'Presenta casos verificables con datos concretos, no promesas.',
    close: 'Déjame enseñarte tres casos de personas que estaban exactamente donde tú estás.',
  },
  {
    id: 'compania',
    level: 'Escalón 2: la compañía',
    belief: 'No cree en ti ni en la empresa.',
    symptom: '¿Y quién eres tú? ¿Cómo sé que no me vas a estafar?',
    script: 'Pon tu reputación al lado del resultado.',
    close: 'Mi reputación va ligada a tu resultado: si tú no cierras, yo pierdo más que tú.',
  },
  {
    id: 'yo',
    level: 'Escalón 3: ella misma',
    belief: 'No cree que sea capaz.',
    symptom: '¿Y si no me sale? Nunca se me ha dado bien vender.',
    script: 'Conecta con la versión de ella que ya lo hizo, con un caso comparable.',
    close: 'Hace seis meses alguien me dijo exactamente lo mismo. La diferencia no fue talento: fue sistema.',
  },
];

export const IDENTITY_FRAMES = {
  disarming:
    'Desarme comparativo: «acabo de hablar con alguien completamente cerrado, respuestas de una palabra… ¿cómo esperas resolver tus problemas si no puedes abrirte conmigo?».',
  rule: 'Los marcos de identidad no son ataques: son espejos. Reflejan la contradicción para que la vea la propia clienta, sin que la closer parezca agresiva.',
};

export type ExamQuestion = {
  id: string;
  question: string;
  type: 'multiple' | 'open';
  options?: string[];
  correctAnswer?: string;
  rubric?: string;
};

export const FINAL_EXAM: ExamQuestion[] = [
  {
    id: 'q1',
    question: '¿Cuál es la ley de hierro del looping al validar una objeción?',
    type: 'multiple',
    options: ['Nunca usar «pero» al validar: siempre «y»', 'Dar el precio al principio', 'No hacer preguntas', 'Cerrar en el primer turno'],
    correctAnswer: 'Nunca usar «pero» al validar: siempre «y»',
  },
  {
    id: 'q2',
    question: '¿Qué marco se usa cuando dice «tengo que consultarlo con mi pareja»?',
    type: 'multiple',
    options: ['Presentar el precio como decidido', 'Apoyo, no permiso', 'Calificar del 1 al 10', 'Explicar el mecanismo'],
    correctAnswer: 'Apoyo, no permiso',
  },
  {
    id: 'q3',
    question: 'En la escalera de creencias, ¿dónde se rompe la venta más a menudo?',
    type: 'multiple',
    options: ['En el método', 'En la empresa', 'En ella misma', 'En el precio'],
    correctAnswer: 'En ella misma',
  },
  {
    id: 'q4',
    question: '¿Qué haces inmediatamente después de soltar el precio?',
    type: 'multiple',
    options: ['Explicar por qué vale eso', 'Guardar silencio', 'Preguntar «¿qué te parece?»', 'Ofrecer un descuento'],
    correctAnswer: 'Guardar silencio',
  },
  {
    id: 'q5',
    question: 'Escribe la secuencia completa de pre-llamada para una cita agendada a 24 horas: los seis mensajes.',
    type: 'open',
    rubric:
      'Tres razones para asistir, presentación personal, vídeo corto, prueba social relevante, confirmación con enlace y una salida digna si no puede. Tono de igual a igual, sin disculpas.',
  },
  {
    id: 'q6',
    question: '¿Qué pregunta comprueba la autoridad dentro de STAR?',
    type: 'multiple',
    options: ['¿Puede decir que sí sin consultar a nadie?', '¿Cuánto factura al mes?', '¿Cuánto tarda en decidir?', '¿Ha probado otros cursos?'],
    correctAnswer: '¿Puede decir que sí sin consultar a nadie?',
  },
  {
    id: 'q7',
    question: '¿Cuál es el protocolo anti-freezing cuando te atacan directamente?',
    type: 'open',
    rubric: 'Aceptar, validar, hacer looping, bajar la velocidad y no defenderse ni justificarse.',
  },
  {
    id: 'q8',
    question: 'En venta lógica, ¿qué haces después de plantear los dos caminos?',
    type: 'multiple',
    options: ['Explicar el precio del programa', 'Guardar silencio', 'Preguntar «¿qué prefieres?»', 'Ofrecer un descuento'],
    correctAnswer: 'Guardar silencio',
  },
];
