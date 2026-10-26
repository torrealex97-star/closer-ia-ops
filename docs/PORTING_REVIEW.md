# Qué más se puede traer de las aplicaciones anteriores

_Revisión del 2026-10-24. Nivel de evidencia: **inspected** — se ha leído el código de las aplicaciones anteriores; no se han ejecutado. Las cifras de esta nota salen de contar los datos de origen, no de una prueba de producto._

Fuentes revisadas: `closer-ai-coach` (`src/data/salesMethodology.ts`, `src/data/proposalData.ts`, `src/lib/aiEngine.ts`, `src/components/InterviewSimulator.tsx`, `ManagerDashboardView.tsx`, `CloserDashboard.tsx`, `src/hooks/useVoice.ts`) y `radar-clientes` (`public/jarvis.js`, `README.md`).

## Ya está dentro: no repetir

- Los ocho módulos y el examen: pre-llamada (6 pasos), show-rate, venta lógica, descubrimiento, anti-freezing, yellows, STAR, cierres, escalera de creencias, marcos de identidad, ruta de cuatro semanas y examen de 6 + 2. Están en [trainingContent.ts](../apps/web/components/trainingContent.ts).
- **Portados el 2026-10-24**: la biblioteca de los 10 cierres exactos y los 9 pasos de descubrimiento, cada uno con su banco de cinco preguntas corregido por clave. De los cierres se descartaron las cifras de ejemplo del original («2.997 €»): van como `[importe]` y `[plazo]` para que nunca se lea un precio inventado.
- Las personas de práctica: 12 situaciones, incluidas las cuatro entrevistadoras (Carlos, Patricia, Miguel, Lucía) y los perfiles de cliente (Marta, Javier, Cristina, Andrés, Nuria, Lucía, Diego, Elena), en [practiceScenarios.ts](../apps/web/components/practiceScenarios.ts) y [prompts.ts](../apps/web/app/api/practice/prompts.ts).
- Las rúbricas: 4 ejes de venta y los 6 criterios ponderados de entrevista WDC, con nota y cita literal validada en servidor.
- Señales deterministas de estilo: «pero» al validar, relleno después del precio, sin siguiente paso, sin preguntas, mensajes largos o cortos, muletillas ([signals.ts](../apps/web/app/api/practice/signals.ts)).
- Dictado por voz, orbe de estados y lectura en voz alta; paneles de progreso de alumna y de coordinación con ejes, racha, evolución semanal y logros.
- El radar de oportunidades con fuentes externas: propio de este repositorio, mejor que el de las aplicaciones anteriores.

## Candidatos, por valor para el producto

### 1. La cebolla de objeciones: 3 capas y reglas de salto — coste medio

`OBJECTION_LAYERS` (circunstancias → terceros → el yo), `OBJECTION_SWAPPING_RULES` (si rebates tiempo, salta a dinero o pareja; nunca revela el salto) y la pregunta de aislamiento («¿es eso lo único que te frena?»). Hoy la práctica tiene escenarios sueltos; con capas, una misma llamada escala y el alumno aprende a aislar antes de rebatir. Toca el prompt del interlocutor y el escenario, no el contrato de la API.

### 2. Commission breath y apertura sumisa como señal — coste bajo

El debrief ya detecta «pero» y relleno tras el precio. Falta el otro detector de `aiEngine.ts`: sobre-entusiasmo («¡qué increíble!»), sumisión («gracias por tu tiempo», «disculpa», «perdona»). Es una regla más en `signals.ts`, con cita literal, y ataca el error más común de quien empieza.

### 3. Banco de 10 preguntas de entrevista con intención, fórmula, ejemplo y banderas rojas — coste medio

`interviewQuestions` (10): experiencia, metodología, la objeción más difícil, «por qué tú», **sin experiencia**, motivación, manejo de presión, **remuneración**, call en vivo y pregunta inversa. Cada una trae qué evalúa el entrevistador, la fórmula de respuesta, un ejemplo y las banderas rojas.

Es la pieza con más valor para aspirantes: se puede usar **sin IA** como modo estudio y autoevaluación (¿doy cifras?, ¿me pongo a la defensiva?, ¿devuelvo una pregunta?), y alimentar las entrevistas simuladas con las preguntas que hoy improvisa el modelo. Las banderas rojas permiten una corrección determinista, no una nota inventada.

### 4. Formato de coaching: una sola carencia y plan de 24 h — coste bajo

`COACHING_RULE`: identificar la única deficiencia de habilidad, contarla en tercera persona para no herir el ego y cerrar con una tarea concreta para las próximas 24 horas. El debrief ya tiene «lo que más te ha frenado» y «siguiente práctica»; falta la disciplina de una sola carencia y la tarea fechada, que es lo que convierte el feedback en hábito.

### 7. Retos asignados y objetivo semanal — coste medio

En `ManagerDashboardView` la coordinadora asigna un reto («tres simulacros de objeción de pareja con nota ≥ 80»); en `CloserDashboard` la alumna marca un objetivo. Hoy el panel de admin informa pero no cierra el circuito. Con la tabla de actividad ya existente, un reto es una fila y una vista; el valor está en que la alumna sepa qué se espera de ella esta semana.

### 8. Voz conversacional con interrupción — coste medio

`useVoice.ts` del proyecto anterior detecta silencio para enviar, filtra el propio eco y permite hablar mientras el interlocutor habla. Aquí el orbe ya marca estados, pero no se puede interrumpir al personaje ni hablar por encima de su voz. Es la diferencia entre dictar y conversar.

### 9. Jarvis como copiloto con memoria — coste alto, decidir antes

`radar-clientes` tiene un Jarvis que ejecuta acciones por voz, recuerda entre sesiones y transmite la respuesta por frases. Aquí el orbe solo señala estado. Un copiloto que abra el módulo que toca, proponga la práctica según los ejes flojos y recuerde lo que costó la última vez sería el mayor diferenciador, pero exige proveedor, presupuesto por alumna y una decisión explícita de coste.

## Lo que no conviene portar

- **La clave del proveedor en el navegador** (`getApiKey`/`setApiKey` en `localStorage`): aquí el proveedor vive en servidor, detrás de `LLMProvider`.
- **La credencial o certificación emitida**: la formación ya dice que no es un título oficial; no se puede inventar uno.
- **Las cifras y casos de ejemplo** («74,2 % de cierre», «12/15 en racha», «primera venta de 3.000 € en tres semanas», testimonios con nombre): son datos inventados y la norma del repositorio es no inventar resultados.
- **El ranking entre alumnas**: el panel actual evita comparar; si se quiere, opt-in y agregado, nunca por defecto.
- **Los avatares con nombre y gema** (Rubí, Esmeralda, Perla, Zafiro): lo aprovechable son sus disparadores de comportamiento (sumisión sube la resistencia, reverse framing la baja), no el personaje ni sus prompts de evaluación.
- **`claude-simulate` y el CRM de `radar-clientes`**: función con clave de terceros y scraping de pago de otro producto.

## Orden sugerido

1. Commission breath y formato de una sola carencia en el debrief.
2. Banco de preguntas con modo estudio y autoevaluación por banderas rojas.
3. Capas de objeción en la práctica (escenario + prompt + lectura en el debrief).
4. Retos y objetivo semanal en los dos paneles.
5. Voz con interrupción; Jarvis copiloto solo después de decidir coste y proveedor.

Los cierres exactos y los nueve pasos ya están dentro (sesión 80): los dos módulos de repertorio, con su banco de cinco preguntas cada uno.

Cada paso necesita su prueba: las piezas deterministas con test de comportamiento, y el contenido con un test de datos (que los 10 cierres y los 9 pasos estén completos y que ninguna cifra de ejemplo se presente como resultado real).
