# Mejora de la sala de práctica a partir de `closer-ai-coach`

Revisión 2026-10-23. **Aprobado el 2026-10-23: bloque I1 y notas 0-100 por eje y global.** I1 entregado (ver [STATUS](../STATUS.md)); I2 (voz) e I3 (repaso/progreso local) siguen pendientes de aprobación, igual que la persistencia con identidad. Nada del paquete se ha copiado literalmente: el método se ha reescrito en los tipos y el tono de este producto.

## Qué se ha revisado

Paquete `closer-ai-coach.zip` (104 archivos, ~11.300 líneas de TS/TSX), revisado fuera del repositorio. Piezas con valor real:

- `src/data/salesMethodology.ts` (1.082 líneas): avatares psicológicos, cebolla de la culpa, LOOPING ACQ, regla de silencio, 10 cierres, 9 pasos de descubrimiento, rúbrica de 7 ejes, regla de coaching, escalera de creencias, pre-llamada, anti-freezing, ruta de certificación.
- `src/data/proposalData.ts` (1.154 líneas): 7 objeciones WDC con fórmula, ejemplo y errores típicos; 4 entrevistadores; 10 preguntas de entrevista con intención, fórmula, ejemplo y banderas rojas.
- `src/lib/aiEngine.ts`: prompts de cliente/entrevistador/evaluador y detectores heurísticos (`detectCommissionBreath`, `detectSTFUViolation`).
- `src/hooks/useVoice.ts`: dictado con detección de silencio, mensajes de error por tipo y lectura en voz alta.
- Simuladores y paneles: rúbrica visible, "respuesta ideal", dificultad, historial, panel de manager, gamificación.

Lo que ya tiene esta app: 4 situaciones ficticias, conversación con Groq detrás de ruta de servidor, feedback con citas verificadas y un solo foco. Este plan cubre el salto de "conversación con feedback" a "entrenamiento con método, repetición medida y práctica hablada".

## Criterios de decisión

1. **Honestidad**: nada de cifras, testimonios ni resultados inventados. Un ejemplo se presenta como ejemplo.
2. **Seguridad**: la clave vive solo en servidor; los prompts no viajan al navegador; sin CORS abierto ni gasto anónimo.
3. **Coste**: primero lo determinista y lo gratuito (señales, repaso, voz del navegador); la IA solo donde aporta.
4. **Diseño**: la práctica debe leerse como el resto del producto, no como un panel de videojuego.

## A. Lo que tomaría

| # | Pieza | Qué aporta | Dónde aterriza |
|---|---|---|---|
| A1 | Cebolla de la culpa (circunstancias → terceros → yo) con intercambio de objeciones | El personaje deja de ceder por cortesía y sube de capa solo si la alumna aísla la objeción | Prompt de personaje, por situación |
| A2 | LOOPING ACQ (aceptar → reencuadrar → pedir) y ley de hierro del «pero» | Da al feedback una regla comprobable en vez de una impresión | Prompt + señal determinista |
| A3 | Regla de silencio (STFU) tras el precio | Ataca el error más caro y más común; se puede detectar sin IA | Prompt + señal |
| A4 | 9 pasos de descubrimiento | Objetivos de escenario con progresión real, no tres frases genéricas | Catálogo de situaciones |
| A5 | Rúbrica por ejes con evidencia | Feedback legible: 4 ejes por tipo, cada uno con veredicto y cita | Respuesta de `debrief` |
| A6 | Coaching de una sola deficiencia, proyección en terceros, tarea de 24 h | Corrige un error por sesión en lugar de listar diez; evita desmoralizar | Campo `focus` + `next` |
| A7 | Respuesta ideal reformulada | La alumna ve cómo sonaría bien con sus propias palabras | Nuevo bloque `model` |
| A8 | Biblioteca de objeciones, cierres, escalera de creencias, STAR, tonos | Estudio consultable antes y después de practicar, sin coste de IA | Vista «Repaso» |
| A9 | Protocolo anti-freezing y «leads difíciles» | Dos situaciones duras que hoy no existen: ataque al ego y respuestas de una palabra | 2 escenarios nuevos |
| A10 | Secuencia de pre-llamada (6 mensajes) | Entrena show-rate, que es donde se pierde la venta antes de la llamada | Ejercicio escrito de una sola respuesta |

Detalles que sí cambian respecto al original:

- **Sin puntuaciones 0-100 ni gráfico de araña** (propuesta; revisable si lo pides). Un número de un LLM parece precisión y no lo es. En su lugar: cada eje con **hecho / parcial / falta** y la cita que lo demuestra. La progresión se lee por ejes ganados entre sesiones, no por un total.
- **Sin cifras ajenas**: el cálculo de coste de inacción se hace con los datos que la alumna extrae en la conversación; nunca con un resultado empaquetado («192.000 €»).
- **Ejemplos, no testimonios**: los casos se etiquetan como ejemplo ficticio. Se eliminan el 98 % de asistencia, el 91 % de retención y las alumnas con nombre y facturación.

## B. Lo que añadiría sin IA

| # | Pieza | Por qué |
|---|---|---|
| B1 | Señales de estilo: «pero» al validar, muletillas, cierre sin pregunta, mensajes-río | Coste cero, verificables y siempre con la frase literal que las dispara |
| B2 | Detector de relleno tras el precio | Se calcula en servidor; se muestra como «posible» para no acusar en falso |
| B3 | Contador por sesión (turnos, longitud media, preguntas) | Da una medida de progreso real sin inventar notas |

Las señales se calculan **antes** de llamar al modelo y se devuelven aunque el modelo falle, para que la sesión nunca quede vacía. Se rotulan como «señales», no como veredictos.

## C. Voz

| # | Pieza | Por qué |
|---|---|---|
| C1 | Dictado con el reconocimiento del navegador, autoenvío por silencio y errores explicados (permiso, iOS, HTTPS) | Hablar es el entrenamiento real; el audio no sale del navegador |
| C2 | Lectura automática del interlocutor, con parada al escribir | Convierte la sala en una llamada, no en un chat |
| C3 | Botón de micrófono honesto: si el navegador no lo soporta, se dice y se sigue en texto | Sin promesas que fallen en silencio |

Se descarta la voz de pago (ElevenLabs/Deepgram/Whisper) en esta fase: cuesta, requiere clave y añade latencia. Primero el navegador; si la calidad no basta, se decide con datos.

## D. Lo que NO tomaría

| # | Pieza descartada | Motivo |
|---|---|---|
| N1 | Clave de Anthropic en `localStorage` y llamada directa desde el navegador | Cualquiera la lee desde DevTools; además permite manipular el prompt |
| N2 | Edge Function con `Access-Control-Allow-Origin: *` sin auth ni límites | Gasto anónimo contra tu cuenta |
| N3 | Prompts de personaje y de evaluador en el cliente | Se pueden reescribir; el feedback deja de ser comparable |
| N4 | Supabase Auth + RLS + migración tal cual | Segundo sistema de identidad sin necesidad; además la migración falla: `profiles` referencia `teams` antes de crearla |
| N5 | `claude-3-5-sonnet-20241022` fijo en el código | Modelo retirado; aquí el proveedor es reemplazable (Groq por defecto) |
| N6 | Notas 0-100 y radar | Falsa precisión; contradice el feedback sin números ya pactado |
| N7 | «Termómetro de moral» que bloquea certificaciones | Inferir moral del audio no es medible ni justo; bloquear a alguien por eso, menos |
| N8 | Estadísticas y casos inventados (98 %, 91 %, 12.000 €, Trustpilot) | Viola la regla de no inventar datos; la técnica se queda, la cifra no |
| N9 | Avatares hotlinkeados y nombres tipo gema | Activos externos y lenguaje ajeno; seguimos con monogramas |
| N10 | Estética oscura con cristal, gemas y brillos | No es la dirección editorial del producto |
| N11 | Panel de manager, asignaciones, ranking, XP y niveles | Necesitan identidad y persistencia que aún no existen; gamificación antes de medir es ruido |
| N12 | Sus pruebas (un único test de ejemplo) | No hay nada que portar |

## E. Incrementos propuestos

Cada uno es un corte cerrado, con pruebas y entrada en `STATUS`. Ninguno toca la recogida de oportunidades.

### I1 — Método en la sala (A1-A7, A9, B1-B3) — **entregado**

Resultado: 8 situaciones (4 actuales + objeción «lo tengo que pensar», objeción de pareja/socio, entrevista con objeción de experiencia, ataque al ego), cada una con nivel (suave / real / dura), capas de resistencia y objetivos de método. El feedback pasa a: resumen, 4 ejes con veredicto y cita, hasta 3 señales de estilo, una respuesta modelo y una sola tarea.

Criterios de aceptación:

- Una situación dura no cede en el primer turno; una suave sí cede antes.
- El debrief nunca muestra una cita que no exista en los mensajes de la alumna (se sigue descartando en servidor).
- Con el proveedor caído, la sesión conserva señales y transcripción; se dice qué falta.
- Un texto con «pero» al validar y relleno tras el precio produce señales citadas.
- Playwright: código, conversación, feedback con ejes y señales, móvil.

Pruebas: unitarias de señales (runner de Playwright importando el módulo puro), Playwright de flujo y contraste, ruta contra proveedor simulado.

### I2 — Practicar hablando (C1-C3)

Resultado: micrófono en la sala, dictado con autoenvío por silencio, lectura automática del interlocutor y mensajes de error útiles. El audio no se envía ni se guarda.

Criterios: sin permiso se explica qué hacer; sin soporte se ofrece texto; el texto dictado pasa por los mismos topes; la conversación sigue siendo navegable con teclado.

### I3 — Repaso y progreso local (A8, A10)

Resultado: vista «Repaso» con objeciones, cierres, creencias, STAR y tonos, buscable; ejercicio de un mensaje de pre-llamada; progreso por ejes en el historial local (8 últimas sesiones), sin XP ni ranking.

Criterios: contenido sin cifras ni casos reales; el ejercicio se evalúa con el mismo patrón de evidencia; el historial no sale del navegador.

### Fuera de este plan (decisión aparte)

Persistencia de sesiones, vista de coordinadora, asignaciones y certificación de 4 semanas necesitan identidad y una base de datos para la web. Hoy la alumna no tiene cuenta y el único D1 vive en el engine de oportunidades. Decidir entre: (a) seguir en local por navegador, (b) D1 en el engine con código de cohorte, (c) Postgres/Auth cuando se aborde el portal. No lo mezclo con la práctica.

## F. Riesgos

| Riesgo | Mitigación |
|---|---|
| El prompt crece y encarece cada turno | Persona + método por situación en ~1.500 tokens; tope de turnos ya existente |
| Señales con falsos positivos | Se muestran como «posible» y con la frase; nunca restan ni bloquean |
| El modelo «actúa» el método en vez de resistirse | Capas explícitas por turno y prueba con proveedor simulado que verifica que no cede antes de tiempo |
| Dictado inexistente en algunos navegadores | Detección, mensaje claro y texto siempre disponible |
| Contenido con jerga o cifras del paquete | Reescritura completa al tono del producto; revisión de textos antes de publicar |
| Deriva a «videojuego» | Sin XP, sin ranking, sin notas; solo ejes y evidencia |

## G. Decisiones tomadas y pendientes

1. **Aprobado**: I1 (método en la sala) y el uso del paquete como material propio reescribible.
2. **Aprobado con matiz**: notas 0-100 por eje y global. Se implementan como **estimación docente** calculada en servidor (media de los ejes), rotulada en la ficha y en el historial; no es una nota oficial ni una probabilidad.
3. **Pendiente de aprobación**: I2 (dictado y lectura automática) e I3 (repaso y progreso por ejes).
4. **Fuera hasta decidir identidad y base de datos**: persistencia de sesiones, vista de coordinadora, asignaciones y certificación de cuatro semanas.

## Evidencia de esta revisión

- Inventario y lectura de los archivos citados; nada copiado al repositorio.
- No se ejecutaron pruebas de runtime: es un cambio solo de documentación.
