import { test, expect } from '@playwright/test';

test('operator can configure search, inspect sources and use mobile navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Su próximo paso empieza aquí.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buscar oportunidades', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Perfil profesional' }).selectOption('closer');
  await page.getByRole('combobox', { name: 'Mercado', exact: true }).selectOption('ES');
  await page.getByText('Afinar búsqueda', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Idioma mencionado' }).selectOption('es');
  await expect(page.getByLabel('Incluir país o fecha sin confirmar')).toBeChecked();
  await expect(page.getByLabel('Exigir evidencia de español (incluye bilingües)')).toBeChecked();
  await page.getByRole('button', { name: 'Fuentes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Himalayas', exact: true })).toBeVisible();
  await expect(page.getByText('API pública activa', { exact: true })).toHaveCount(6);
  await expect(page.getByRole('heading', { name: 'InfoJobs', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Oportunidades', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Buscar oportunidades', exact: true })).toBeVisible();
});

test('source setup preloads Spanish keywords, preserves secret and edits URLs', async ({ page }) => {
  let saved: Record<string, unknown>[] = [];
  await page.route('**/api/backend/source-connections', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.urls).toEqual(['https://www.infojobs.net/ofertas-trabajo/closer']);
      expect(body.actor_input.onlyTeleworking).toBe(true);
      expect(body.mapping.work_mode).toBe('teleworking');
      const { token, clear_token, ...rest } = body;
      saved = [{ ...rest, id: 'apify-browser-test', has_token: !!token }];
      await route.fulfill({ json: saved[0] });
    } else await route.fulfill({ json: saved });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Fuentes', exact: true }).click();
  await page.getByLabel('Buscar fuente').fill('InfoJobs');
  await page.getByRole('button', { name: 'Conectar', exact: true }).click();
  await expect(page.getByLabel('Actor ID', { exact: true })).toHaveValue('haketa/infojobs-scraper');
  await page.getByLabel('Token API de Apify').fill('fake-browser-token');
  await page.getByLabel('Enlaces a scrapear · uno por línea').fill('https://www.infojobs.net/ofertas-trabajo/closer');
  await page.getByRole('button', { name: 'Guardar conexión', exact: true }).click();
  await expect(page.getByText('Token guardado', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.getByLabel('Token API de Apify')).toHaveValue('');
  await expect(page.getByLabel('Enlaces a scrapear · uno por línea')).toHaveValue('https://www.infojobs.net/ofertas-trabajo/closer');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('backend proxy rejects other web origins', async ({ request }) => {
  const response = await request.get('/api/backend/config', { headers: { Origin: 'https://example.com' } });
  expect(response.status()).toBe(403);
});
