import { test, expect } from '@playwright/test';

const debrief = {
  summary: 'Has abierto con contexto y has preguntado por el seguimiento. La apertura aún pide demasiada explicación antes de interesar.',
  focus: 'Cerrar con un siguiente paso concreto en vez de dejar la conversación abierta.',
  strengths: ['Pides permiso antes de entrar en materia', 'Devuelves una pregunta en lugar de justificarte'],
  improvements: ['Abre con el problema, no con el producto', 'Propón un siguiente paso con día y hora'],
  axes: [
    { id: 'apertura', label: 'Apertura y marco', score: 78, note: 'Entras con contexto y sin disculparte.', quote: 'Me interesa entender cómo gestionáis los seguimientos' },
    { id: 'descubrimiento', label: 'Descubrimiento', score: 64, note: 'Preguntas, pero aún no cuantificas el coste.', quote: 'Te llamo porque he visto que perdéis seguimientos' },
    { id: 'objecion', label: 'Objeciones', score: 58, note: 'No hubo objeción que trabajar en esta conversación.', quote: '' },
    { id: 'cierre', label: 'Cierre', score: 42, note: 'La conversación termina sin día ni hora.', quote: '' },
  ],
  score: 61,
  signals: [
    { id: 'sin-paso', label: 'Sin siguiente paso concreto', detail: 'Un día, una hora y una acción pequeña convierten el interés en algo que se puede cumplir.', quote: 'Me interesa entender cómo gestionáis los seguimientos' },
    { id: 'largo', label: 'Un mensaje demasiado largo', detail: 'Ese mensaje tiene 340 caracteres. En una llamada real, tres frases seguidas suelen perder al interlocutor.', quote: 'Me interesa entender cómo gestionáis los seguimientos' },
  ],
  model: 'Marta, por lo que me cuentas el seguimiento se pierde en el correo. ¿Qué pasa cuando un cliente ya dijo que sí y no recibe respuesta?',
  next: 'Repite la llamada cerrando con una reunión de 15 minutos el jueves a las 10:00.',
};

// La vista de alumna carga oportunidades al montar: se neutraliza para aislar la práctica.
const emptyCatalog = (route: import('@playwright/test').Route) => route.fulfill({ json: { items: [], total: 0 } });

test('la sala de práctica abre sin código, conversa y devuelve feedback con ejes y señales', async ({ page }) => {
  const calls: Record<string, unknown>[] = [];
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.route('**/api/practice', route => {
    const body = route.request().postDataJSON();
    calls.push(body);
    if (body.mode === 'debrief') return route.fulfill({ json: { debrief } });
    return route.fulfill({ json: { reply: 'Entiendo. ¿Y cómo lo estaríais midiendo?' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sala de práctica' }).click();
  await expect(page.getByRole('heading', { name: 'Ensaya la conversación antes de la real.' })).toBeVisible();
  await expect(page.locator('.practice-card')).toHaveCount(8);
  await expect(page.locator('.practice-level[data-intensity="dura"]')).toHaveCount(3);
  // Sin puerta previa: «Practicar» entra directo a la sala.
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  await expect(page.getByText('¿Sí? Dime, que estoy entre reuniones.')).toBeVisible();
  expect(await page.locator('.practice-gate').count()).toBe(0);
  const reply = page.getByLabel('Tu respuesta');
  await reply.fill('Hola Marta, te llamo porque he visto que perdéis seguimientos.');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  await expect(page.getByText('Entiendo. ¿Y cómo lo estaríais midiendo?')).toBeVisible();
  await reply.fill('Me interesa entender cómo gestionáis los seguimientos');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  await expect(page.locator('.practice-turn.is-mine')).toHaveCount(2);
  await page.getByRole('button', { name: 'Terminar y ver feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Qué ha funcionado y qué pulir.' })).toBeVisible();
  // La nota global es la media de los ejes y se presenta como estimación.
  await expect(page.locator('.practice-score-total b')).toHaveText('61');
  await expect(page.locator('.practice-score-total small')).toHaveText('estimación');
  await expect(page.locator('.practice-axis')).toHaveCount(4);
  await expect(page.locator('.practice-axis dt b')).toHaveText(['78', '64', '58', '42']);
  await expect(page.getByRole('meter', { name: 'Cierre: 42 de 100' })).toHaveAttribute('aria-valuenow', '42');
  await expect(page.getByText('LO QUE MÁS TE HA FRENADO')).toBeVisible();
  await expect(page.getByText('Cerrar con un siguiente paso concreto en vez de dejar la conversación abierta.')).toBeVisible();
  // Señales deterministas y respuesta modelo.
  await expect(page.getByRole('heading', { name: 'Señales de estilo' })).toBeVisible();
  await expect(page.locator('.practice-signals li')).toHaveCount(2);
  await expect(page.getByText('Sin siguiente paso concreto')).toBeVisible();
  await expect(page.getByText(/Una forma posible con tus propias palabras/)).toBeVisible();
  expect(calls.filter(call => call.mode === 'debrief')).toHaveLength(1);
  // La petición ya no lleva código de cohorte.
  expect(calls.every(call => !('code' in call))).toBe(true);
  await expect(page.locator('.practice-debrief > .practice-note')).toHaveText(/no es una nota oficial/i);
  // El historial local conserva la puntuación de la sesión.
  await page.getByRole('button', { name: 'Elegir otra situación' }).click();
  await expect(page.locator('.practice-history-score')).toHaveText('61/100');
});

test('una práctica vieja sin ejes se sigue pudiendo leer desde el historial', async ({ page }) => {
  const legacy = {
    id: 'vieja-1', scenarioId: 'venta-fria', title: 'Llamada en frío a una directora de marketing', startedAt: Date.now(), turns: 2,
    debrief: { summary: 'Resumen antiguo.', strengths: ['Algo bien'], improvements: ['Algo a pulir'], moments: [{ quote: 'Hola', why: 'Apertura.' }], next: 'Repite.' },
  };
  await page.addInitScript(value => {
    window.localStorage.setItem('wdc_practice_history', JSON.stringify([value]));
  }, legacy);
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await page.getByRole('button', { name: 'Sala de práctica' }).click();
  await expect(page.locator('.practice-history li')).toHaveCount(1);
  await expect(page.locator('.practice-history-score')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ver feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Qué ha funcionado y qué pulir.' })).toBeVisible();
  await expect(page.locator('.practice-moments blockquote')).toHaveText('«Hola»');
  await expect(page.locator('.practice-score')).toHaveCount(0);
});

test('un error del proveedor no pierde la conversación ni la puerta vuelve', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.route('**/api/practice', route => route.fulfill({ status: 502, json: { detail: 'No se ha podido completar la respuesta. La conversación no se ha perdido: vuelve a intentarlo.' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sala de práctica' }).click();
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  await page.getByLabel('Tu respuesta').fill('Hola, ¿qué tal?');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  await expect(page.locator('.practice-error')).toHaveText(/no se ha perdido/);
  // Se queda en la sala con lo escrito: no hay puerta a la que volver.
  await expect(page.locator('.practice-turn.is-mine')).toHaveCount(1);
  await expect(page.getByLabel('Tu respuesta')).toBeVisible();
});

test('la sala cierra la conversación antes de que el feedback sea imposible', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.route('**/api/practice', route => {
    const body = route.request().postDataJSON();
    if (body.mode === 'debrief') return route.fulfill({ json: { debrief } });
    return route.fulfill({ json: { reply: 'Entiendo. ¿Y cómo lo mediríais?' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sala de práctica' }).click();
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  const reply = page.getByLabel('Tu respuesta');
  const send = page.getByRole('button', { name: 'Enviar respuesta' });
  // Diez respuestas llevan la conversación al tope de la sala (20 turnos).
  for (let i = 0; i < 10; i++) {
    await reply.fill(`Mensaje ${i + 1}: te cuento cómo lo gestionamos.`);
    await send.click();
    await expect(page.locator('.practice-turn.is-mine')).toHaveCount(i + 1);
    await expect(page.locator('.practice-turn.is-them .practice-bubble:not(.is-typing)')).toHaveCount(i + 2);
  }
  await expect(reply).toBeDisabled();
  await expect(page.locator('.practice-finish small')).toContainText('final de la simulación');
  // El feedback sigue disponible: la conversación nunca queda en un callejón sin salida.
  await page.getByRole('button', { name: 'Terminar y ver feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Qué ha funcionado y qué pulir.' })).toBeVisible();
});

test('sin proveedor la sala lo dice y no inventa una respuesta', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.route('**/api/practice', route => route.fulfill({ status: 503, json: { detail: 'La sala de práctica no está configurada en este despliegue.' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sala de práctica' }).click();
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  await page.getByLabel('Tu respuesta').fill('Hola, ¿qué tal?');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  await expect(page.locator('.practice-error')).toHaveText(/no está configurada/);
  // Solo la apertura del interlocutor: no se fabrica una réplica si el proveedor falla.
  await expect(page.locator('.practice-turn.is-them')).toHaveCount(1);
  // El mensaje de la alumna sigue en la conversación.
  await expect(page.locator('.practice-turn.is-mine')).toHaveCount(1);
});
