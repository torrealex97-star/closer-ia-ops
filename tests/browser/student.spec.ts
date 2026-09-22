import { test, expect } from '@playwright/test';

const offer = { id: 'student-fixture', role: 'closer', role_label: 'Closer', original_title: 'Closer de ventas', company: 'Empresa de prueba', compensation: 'Salario base de 600 USD + comisiones.', compensation_note: 'La parte variable no es un ingreso garantizado.', modality: 'Remoto', location: 'España', language: 'Anuncio en español', experience: 'Experiencia: 2 años en ventas.', schedule: 'Jornada: tiempo completo.', contract: 'Contrato: freelance.', description: 'Buscamos una closer para nuestro equipo de ventas. Trabajo remoto.', published_at: new Date().toISOString(), expires_at: new Date(Date.now() + 864000000).toISOString(), source_name: 'Portal de empleo', source_url: 'https://example.com/job', starred: false };

test('student sees three profiles and decision facts without operational controls', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/backend/opportunities/search', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { items: [offer], total: 1 } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Elige tu próxima oportunidad.' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Perfil profesional' }).locator('option')).toHaveText(['Closer', 'Setter', 'Cold Caller']);
  await expect(page.getByRole('heading', { name: offer.compensation })).toBeVisible();
  await expect(page.getByText(offer.schedule)).toBeVisible();
  await expect(page.getByText(offer.experience)).toBeVisible();
  await expect(page.getByText(offer.language)).toBeVisible();
  expect(requests[0].include_bilingual).toBe(false);
  await expect(page.getByText(/scraper|Apify|presupuesto|para tus alumnas|encaje \/100/i)).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Perfil profesional' }).selectOption('cold_caller');
  await page.getByRole('button', { name: 'Ver oportunidades', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.role).toBe('cold_caller');
  await page.getByRole('button', { name: 'Ver oportunidad', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver proceso de candidatura' })).toHaveAttribute('href', offer.source_url);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('heading', { name: offer.compensation })).toBeVisible();
});

test('student saves an opportunity and bilingual notices are an explicit choice', async ({ page }) => {
  let starred = false;
  let bilingual = false;
  await page.route('**/api/backend/jobs/student-fixture/star', route => {
    starred = route.request().postDataJSON().starred;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/backend/opportunities/search', route => {
    const query = route.request().postDataJSON();
    bilingual = query.include_bilingual;
    return route.fulfill({ json: { items: query.starred_only && !starred ? [] : [{ ...offer, starred }], total: 1 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Guardar Closer · Empresa de prueba', exact: true }).click();
  await expect.poll(() => starred).toBe(true);
  await page.getByRole('button', { name: 'Guardadas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Las que te interesan.' })).toBeVisible();
  await page.getByRole('button', { name: 'Quitar de guardadas Closer · Empresa de prueba' }).click();
  await expect(page.getByRole('heading', { name: 'Guarda las que te hagan dar el siguiente paso.' })).toBeVisible();
  await page.getByRole('button', { name: 'Oportunidades', exact: true }).click();
  await page.getByLabel('También oportunidades bilingües español / inglés').check();
  await page.getByRole('button', { name: 'Ver oportunidades', exact: true }).click();
  await expect.poll(() => bilingual).toBe(true);
});
