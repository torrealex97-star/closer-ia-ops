import { test, expect } from '@playwright/test';

test('operator can configure search, inspect sources and use mobile navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Su próximo paso empieza aquí.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buscar oportunidades', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Perfil profesional' }).selectOption('closer');
  await page.getByRole('combobox', { name: 'Mercado', exact: true }).selectOption('ES');
  await page.getByText('Afinar búsqueda', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Idioma mencionado' }).selectOption('es');
  await expect(page.getByLabel('Incluir país, fecha o idioma sin confirmar')).toBeChecked();
  await page.getByRole('button', { name: 'Fuentes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Himalayas', exact: true })).toBeVisible();
  await expect(page.getByText('Pendiente', { exact: true })).toHaveCount(4);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Oportunidades', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Buscar oportunidades', exact: true })).toBeVisible();
});

test('backend proxy rejects other web origins', async ({ request }) => {
  const response = await request.get('/api/backend/config', { headers: { Origin: 'https://example.com' } });
  expect(response.status()).toBe(403);
});
