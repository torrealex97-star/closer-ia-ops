// Catálogo visible de prácticas. Sin empresas reales: toda situación es ficticia y
// la UI lo dice. Los prompts de cada personaje viven solo en el servidor, igual que
// las capas de resistencia: aquí solo se declara lo que la alumna ve.
export type PracticeScenario = {
  id: string;
  kind: 'venta' | 'entrevista';
  // Entrevista con perfil: usa la rúbrica WDC de seis criterios en vez de los cuatro genéricos.
  rubric?: 'wdc-entrevista';
  title: string;
  context: string;
  summary: string;
  objectives: string[];
  opening: string;
  level: string;
  intensity: 'suave' | 'real' | 'dura';
  minutes: number;
};

export const INTENSITY_LABELS: Record<PracticeScenario['intensity'], string> = {
  suave: 'Suave',
  real: 'Real',
  dura: 'Dura',
};

export const PRACTICE_SCENARIOS: PracticeScenario[] = [
  {
    id: 'venta-fria',
    kind: 'venta',
    title: 'Llamada en frío a una directora de marketing',
    context: 'Empresa ficticia de software para clínicas · 25 personas',
    summary: 'Te dan treinta segundos para ganarte la conversación. Practicas la apertura, la pregunta que descubre dolor y la petición de siguiente paso.',
    objectives: ['Abrir con contexto y pedir permiso', 'Descubrir un problema concreto', 'Cuantificar el coste de seguir igual', 'Cerrar un siguiente paso con día y hora'],
    opening: '¿Sí? Dime, que estoy entre reuniones.',
    level: 'Closer · primera llamada',
    intensity: 'real',
    minutes: 6,
  },
  {
    id: 'objeciones-precio',
    kind: 'venta',
    title: '«Me parece caro» a mitad de la propuesta',
    context: 'Academia ficticia · decide el gerente',
    summary: 'La oportunidad está viva, pero el precio frena. Practicas preguntar antes de rebajar, separar valor de coste y no regalar descuentos.',
    objectives: ['Agradecer la sinceridad sin justificarte', 'Aislar si es liquidez o valor', 'Reencuadrar con lo que ya te ha contado', 'Proponer un paso sin rebajar a ciegas'],
    opening: 'Mira, el equipo me gusta. Pero el precio que me pasáis me parece alto para lo que es.',
    level: 'Closer · objeciones',
    intensity: 'real',
    minutes: 6,
  },
  {
    id: 'venta-pensarlo',
    kind: 'venta',
    title: '«Lo tengo que pensar» al final de la llamada',
    context: 'Consultoría ficticia · la decisión se enfría',
    summary: 'El «lo pensaré» casi nunca es la objeción real. Practicas frenar la salida con una pregunta concreta en vez de despedirte con un correo.',
    objectives: ['Validar la prudencia sin empujar', 'Preguntar qué dato falta para decidir', 'Separar duda real de cortesía', 'Pedir una decisión pequeña hoy'],
    opening: 'Mira, me ha gustado lo que me has contado, pero es una decisión importante. Lo tengo que pensar y te escribo.',
    level: 'Closer · cierre',
    intensity: 'real',
    minutes: 7,
  },
  {
    id: 'venta-pareja',
    kind: 'venta',
    title: '«Tengo que hablarlo con mi socio»',
    context: 'Agencia ficticia · dos socias, decisiones conjuntas',
    summary: 'El tercero como escudo. Practicas averiguar su opinión antes de dar argumentos y convertir el permiso en apoyo, sin atacar a nadie.',
    objectives: ['Validar la decisión conjunta', 'Averiguar su opinión propia', 'Preparar la conversación de casa', 'Pedir apoyo, no permiso'],
    opening: 'Antes de decidir nada tengo que hablarlo con mi socio. Nosotros no tomamos estas decisiones por separado.',
    level: 'Closer · objeciones',
    intensity: 'dura',
    minutes: 7,
  },
  {
    id: 'venta-cerrada',
    kind: 'venta',
    title: '«No me estás diciendo nada nuevo»',
    context: 'Clínica ficticia · la conversación se ha enfriado',
    summary: 'Un ataque directo en mitad de la llamada. Practicas no defenderte, validar lo que hay de cierto y recuperar el marco con una pregunta.',
    objectives: ['No justificarte ni acelerar', 'Aceptar y validar sin «pero»', 'Devolver una pregunta que abra dolor', 'Sostener el silencio sin rellenarlo'],
    opening: 'Te voy a ser sincera: llevamos veinte minutos y no me has dicho nada que no pudiera leer en vuestra web.',
    level: 'Closer · alta presión',
    intensity: 'dura',
    minutes: 7,
  },
  {
    id: 'entrevista-closer',
    kind: 'entrevista',
    title: 'Entrevista para closer junior',
    context: 'Entrevista ficticia · responsable de ventas',
    summary: 'Te preguntan por tu experiencia, cómo trabajas una objeción y cómo mides tu trabajo. Practicas respuestas concretas con ejemplos.',
    objectives: ['Contar un ejemplo real con resultado', 'Explicar cómo trabajas una objeción', 'Decir cómo mides tu trabajo', 'Hacer al menos una pregunta al final'],
    opening: 'Gracias por venir. Cuéntame un poco cómo has llegado hasta aquí y por qué ventas.',
    level: 'Entrevista · closer',
    intensity: 'real',
    minutes: 8,
  },
  {
    id: 'entrevista-setter',
    kind: 'entrevista',
    title: 'Entrevista para setter de citas',
    context: 'Entrevista ficticia · sales manager',
    summary: 'El puesto es abrir conversaciones y agendar, no cerrar. Practicas volumen, seguimiento y cómo explicar tu método sin venderte de más.',
    objectives: ['Explicar tu forma de abrir una conversación', 'Hablar de constancia y seguimiento', 'Contar cómo reaccionas al rechazo', 'Preguntar por el día a día del puesto'],
    opening: 'Antes de entrar en materia: ¿qué te atrae de un puesto de setter y no de closer?',
    level: 'Entrevista · setter',
    intensity: 'real',
    minutes: 8,
  },
  {
    id: 'entrevista-experiencia',
    kind: 'entrevista',
    title: '«No conoces el sector» en la entrevista',
    context: 'Entrevista ficticia · dueña de una empresa de servicios',
    summary: 'Te cuestionan la falta de experiencia en su sector. Practicas reconocer el hueco sin disculparte y demostrar un plan de rampa concreto.',
    objectives: ['Reconocer el hueco sin disculparte', 'Explicar un plan de rampa concreto', 'Transferir una habilidad con ejemplo', 'Cerrar con un próximo paso'],
    opening: 'Veo que vienes de otro sector. ¿Qué te hace pensar que puedes vender esto sin conocerlo?',
    level: 'Entrevista · objeción',
    intensity: 'dura',
    minutes: 9,
  },
  // Entrevistas por perfil (rúbrica WDC de seis criterios).
  {
    id: 'perfil-directo',
    kind: 'entrevista',
    rubric: 'wdc-entrevista',
    title: 'Entrevista con Carlos, el dueño directo',
    context: 'Empresa ficticia de servicios B2B · 14 personas',
    summary: 'Un dueño que va al grano: quiere números, casos y retorno. Practicas responder corto, con cifras propias, sin rodeos.',
    objectives: ['Dar cifras concretas sin inflarlas', 'Contar un caso con resultado', 'Aceptar una repregunta sin ponerte a la defensiva', 'Cerrar con una pregunta de negocio'],
    opening: 'Vamos al grano, que tengo poco tiempo. ¿Cuántas llamadas haces al día y cuál es tu tasa de cierre?',
    level: 'Entrevista · dueño directo',
    intensity: 'real',
    minutes: 8,
  },
  {
    id: 'perfil-esceptico',
    kind: 'entrevista',
    rubric: 'wdc-entrevista',
    title: 'Entrevista con Patricia, la escéptica',
    context: 'Agencia ficticia · ya contrató closers que no funcionaron',
    summary: 'Ha quemado dinero con closers y no cree nada sin pruebas. Practicas sostener la confianza cuando cada afirmación se cuestiona.',
    objectives: ['No defenderte de la desconfianza', 'Dar un ejemplo verificable, no una promesa', 'Reconocer lo que no tienes medido', 'Proponer cómo demostrarlo'],
    opening: 'Te seré sincera: he contratado a tres closers y ninguno ha durado. ¿Por qué debería creerte a ti?',
    level: 'Entrevista · escéptica',
    intensity: 'dura',
    minutes: 9,
  },
  {
    id: 'perfil-amable',
    kind: 'entrevista',
    rubric: 'wdc-entrevista',
    title: 'Entrevista con Miguel, el amable',
    context: 'Tienda online ficticia · equipo pequeño',
    summary: 'Conversación relajada que observa si eres auténtica o recitas un guion. Practicas conectar sin perder concreción.',
    objectives: ['Contar quién eres sin guion', 'Conectar con su forma de trabajar', 'No perder las cifras por quedar bien', 'Hacer una pregunta personal y otra de negocio'],
    opening: 'Qué gusto conocerte. Antes de nada, cuéntame cómo llegaste a ventas, sin el discurso de siempre.',
    level: 'Entrevista · cercana',
    intensity: 'suave',
    minutes: 7,
  },
  {
    id: 'perfil-exigente',
    kind: 'entrevista',
    rubric: 'wdc-entrevista',
    title: 'Entrevista con Lucía, la exigente',
    context: 'Startup ficticia · busca closer senior',
    summary: 'Nivel alto: pide métricas complejas, escalabilidad y criterio propio. Practicas no desmoronarte cuando la pregunta sube de nivel.',
    objectives: ['Razonar sobre métricas, no solo recitarlas', 'Explicar cómo escalar proceso', 'Sostener una pregunta que no sabes', 'Cerrar con una hipótesis propia'],
    opening: 'Necesito una closer senior. ¿Cómo decide tu equipo en qué invertir el esfuerzo comercial cuando el ciclo se alarga?',
    level: 'Entrevista · senior',
    intensity: 'dura',
    minutes: 10,
  },
];

export const scenarioById = (id: string) => PRACTICE_SCENARIOS.find(item => item.id === id) ?? null;
