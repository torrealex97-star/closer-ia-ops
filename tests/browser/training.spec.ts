import { test, expect } from '@playwright/test';
import { CLOSE_BANK, DISCOVERY_BANK, EXACT_CLOSES, FINAL_EXAM, PRE_CALL_STEPS } from '../../apps/web/components/trainingContent';

// La vista de alumna carga oportunidades al montar: se neutraliza para aislar formación.
const emptyCatalog = (route: import('@playwright/test').Route) => route.fulfill({ json: { items: [], total: 0 } });
const open = async (page: import('@playwright/test').Page, title: string) => {
  await page.getByRole('button', { name: 'Formación' }).click();
  await page.locator('.training-grid .training-card').filter({ hasText: title }).getByRole('button', { name: 'Abrir módulo' }).click();
};

test('la formación ofrece los ocho módulos y revisa la secuencia de pre-llamada', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await page.getByRole('button', { name: 'Formación' }).click();
  await expect(page.getByRole('heading', { name: 'Aprende el método antes de improvisar.' })).toBeVisible();
  await expect(page.locator('.training-grid .training-card')).toHaveCount(8);
  await expect(page.locator('.training-grid .training-card').first()).toContainText('Ejercicio sin nota');

  await page.locator('.training-grid .training-card').first().getByRole('button', { name: 'Abrir módulo' }).click();
  await expect(page.getByRole('heading', { name: 'Pre-llamada y show-rate' })).toBeVisible();
  await expect(page.locator('.training-step')).toHaveCount(6);
  // El ejemplo malo enseña lo que falta, sin llamarlo suspenso.
  const message = page.getByLabel('Tu mensaje para este momento');
  await message.fill(PRE_CALL_STEPS[0].exampleBad);
  await page.getByRole('button', { name: 'Revisar mi mensaje' }).click();
  await expect(page.locator('.training-outcome')).toHaveAttribute('data-done', 'false');
  await expect(page.locator('.training-criteria li[data-ok="false"]')).not.toHaveCount(0);
  // El ejemplo bueno del método cumple todos los criterios del paso.
  await message.fill(PRE_CALL_STEPS[0].exampleGood);
  await page.getByRole('button', { name: 'Revisar mi mensaje' }).click();
  await expect(page.locator('.training-outcome')).toHaveAttribute('data-done', 'true');
  await expect(page.locator('.training-outcome-head b')).toHaveText('6/6');
  await expect(page.locator('.training-step').first()).toHaveAttribute('data-done', 'true');
});

test('venta lógica comprueba las tres cuentas y la frase no pide aprobación', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await open(page, 'Venta lógica');
  await expect(page.getByRole('heading', { name: 'Venta lógica' })).toBeVisible();

  await page.getByLabel('Brecha mensual').fill('3.200');
  await page.getByLabel('Coste de seguir igual cinco años').fill('19.200');
  await page.getByLabel('Meses de ahorro para igualar un mes de brecha').fill('16');
  await page.getByRole('button', { name: 'Comprobar el cálculo' }).click();
  await expect(page.locator('.training-outcome-head b')).toHaveText('2/3');
  await expect(page.getByText(/192\.000 €/).first()).toBeVisible();

  await page.getByLabel('Coste de seguir igual cinco años').fill('192.000');
  await page.getByRole('button', { name: 'Comprobar el cálculo' }).click();
  await expect(page.locator('.training-outcome-head b')).toHaveText('3/3');
  await expect(page.locator('.training-script')).toContainText('192.000 €');

  await page.getByLabel('Tu frase').fill('Tienes dos caminos: seguir igual con 1.800 € o poner un sistema. En cinco años la diferencia son 192.000 €. Tú eliges.');
  await page.getByRole('button', { name: 'Revisar mi frase' }).click();
  await expect(page.locator('.training-outcome').last().locator('.training-outcome-head b')).toHaveText('3/3');

  await page.getByLabel('Tu frase').fill('Son 192.000 € de diferencia. ¿Qué te parece?');
  await page.getByRole('button', { name: 'Revisar mi frase' }).click();
  await expect(page.locator('.training-criteria li', { hasText: 'Deja que responda ella' })).toBeVisible();
});

test('anti-freezing mide el protocolo sobre el texto y yellows bloquea sin preguntas', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await open(page, 'Anti-freezing');
  const reply = page.getByLabel('Tu respuesta al ataque');
  for (let i = 0; i < 5; i++) {
    await reply.fill('De acuerdo contigo, es razonable. Y al mismo tiempo, ¿qué te hizo llamar?');
    await page.getByRole('button', { name: 'Responder' }).click();
  }
  await expect(page.locator('.training-turn')).toHaveCount(10);
  await expect(page.locator('.training-turn[data-mine="true"]').last()).toContainText('¿qué te hizo llamar?');
  await expect(page.locator('.training-outcome-head b')).toHaveText('7/7');
  await expect(page.locator('.training-moral b').first()).toHaveText('Alta');

  await page.getByRole('button', { name: 'Todos los módulos' }).click();
  await open(page, 'Yellows are golds');
  const toLead = page.getByLabel('Tu mensaje al lead');
  for (let i = 0; i < 3; i++) {
    await toLead.fill('Vale.');
    await page.getByRole('button', { name: 'Enviar' }).click();
  }
  await expect(page.getByText('Bloqueado: tres mensajes sin pregunta.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar desde cero' })).toBeVisible();
});

test('STAR impide cerrar sin calificar y el examen se corrige sobre las respuestas únicas', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await open(page, 'Calificación STAR');
  await page.getByRole('button', { name: 'Intentar cerrar con este lead' }).click();
  await expect(page.getByText('Intento de cierre sin calificar')).toBeVisible();
  for (const name of ['Situación', 'Timing', 'Autoridad', 'Recursos']) await page.getByRole('checkbox', { name: new RegExp(name) }).check();
  await expect(page.getByRole('button', { name: 'Lead calificado: puedes cerrar' })).toBeVisible();
  await page.getByRole('button', { name: 'Lead calificado: puedes cerrar' }).click();
  await expect(page.getByText('Los cuatro criterios están verificados.')).toBeVisible();

  await page.getByRole('button', { name: 'Todos los módulos' }).click();
  await open(page, 'Ruta de cuatro semanas');
  await expect(page.locator('.training-week')).toHaveCount(4);
  const questions = page.locator('.training-question');
  await expect(questions).toHaveCount(FINAL_EXAM.length);
  const multiple = FINAL_EXAM.filter(question => question.type === 'multiple');
  for (const question of multiple) {
    const index = FINAL_EXAM.findIndex(item => item.id === question.id);
    await questions.nth(index).getByRole('radio', { name: question.correctAnswer! }).check();
  }
  // Las dos de desarrollo no suman nota ni bloquean la corrección.
  await page.getByRole('button', { name: 'Corregir el examen' }).click();
  await expect(page.locator('.training-result-score b')).toHaveText('100');
  await expect(page.getByRole('heading', { name: 'Examen superado' })).toBeVisible();
  await expect(page.getByText(/no es una certificación oficial/)).toBeVisible();
  await expect(page.getByText('Sin respuesta.')).toHaveCount(2);

  await page.getByRole('button', { name: 'Todos los módulos' }).click();
  await expect(page.locator('.training-grid .training-card').filter({ hasText: 'Ruta de cuatro semanas' }).locator('.training-card-foot span')).toHaveText('Examen superado · 100/100');
});

test('los diez cierres y los nueve pasos se estudian y se corrigen por clave', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await open(page, 'Los diez cierres');
  await expect(page.getByRole('heading', { name: 'Los diez cierres' })).toBeVisible();
  await expect(page.locator('.training-ladder > li')).toHaveCount(EXACT_CLOSES.length);
  await expect(page.getByText('[importe]').first()).toBeVisible();
  const bank = page.getByTestId('bank-cierres');
  await expect(bank.getByRole('button', { name: 'Corregir mis respuestas' })).toBeDisabled();
  for (const [i, q] of CLOSE_BANK.entries()) await bank.locator('.training-question').nth(i).getByLabel(i === 0 ? q.options.find(o => o !== q.answer)! : q.answer, { exact: true }).check();
  await bank.getByRole('button', { name: 'Corregir mis respuestas' }).click();
  await expect(bank.locator('.training-result-score b')).toHaveText('4');
  await expect(bank.getByText(`Era: ${CLOSE_BANK[0].answer}.`)).toBeVisible();
  await bank.getByRole('button', { name: 'Repetir' }).click();
  await expect(bank.getByRole('button', { name: 'Corregir mis respuestas' })).toBeDisabled();

  await page.getByRole('button', { name: 'Todos los módulos' }).click();
  await open(page, 'Los nueve pasos de descubrimiento');
  await expect(page.locator('.training-ladder > li')).toHaveCount(9);
  const steps = page.getByTestId('bank-descubrimiento');
  for (const [i, q] of DISCOVERY_BANK.entries()) await steps.locator('.training-question').nth(i).getByLabel(q.answer, { exact: true }).check();
  await steps.getByRole('button', { name: 'Corregir mis respuestas' }).click();
  await expect(steps.locator('.training-result-score b')).toHaveText('5');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
