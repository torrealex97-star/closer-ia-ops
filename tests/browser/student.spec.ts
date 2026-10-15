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
  await expect(page.getByRole('combobox', { name: 'Perfil profesional' }).locator('option')).toHaveText(['Todos los perfiles', 'Closer', 'Setter', 'Cold Caller', 'Ejecutivo comercial', 'SDR / BDR']);
  await expect(page.getByRole('heading', { name: offer.compensation })).toBeVisible();
  await expect(page.getByText(offer.schedule)).toBeVisible();
  await expect(page.getByText(offer.experience)).toBeVisible();
  await expect(page.getByText(offer.language)).toBeVisible();
  expect(requests[0].include_bilingual).toBe(false);
  await expect(page.getByText(/scraper|Apify|presupuesto|para tus alumnas|encaje \/100/i)).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Perfil profesional' }).selectOption('cold_caller');
  await page.getByRole('button', { name: 'Ver oportunidades', exact: true }).click();
  await expect.poll(() => requests.some(r => r.role === 'cold_caller')).toBe(true);
  await page.getByRole('button', { name: 'Ver oportunidad', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver proceso de candidatura' })).toHaveAttribute('href', offer.source_url);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('heading', { name: offer.compensation })).toBeVisible();
});

test('student filters survive a reload via the URL', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/backend/opportunities/search', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { items: [offer], total: 1 } });
  });
  await page.goto('/');
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests.at(-1)?.role).toBeNull();
  await page.getByRole('combobox', { name: 'Perfil profesional' }).selectOption('cold_caller');
  // El bucket ampliado (filtro estrecho <10) dispara una segunda petición role:null;
  // las aserciones aíslan las peticiones primarias en vez de mirar la última.
  await page.getByRole('button', { name: 'Ver oportunidades', exact: true }).click();
  await expect.poll(() => requests.some(r => r.role === 'cold_caller')).toBe(true);
  expect(new URL(page.url()).searchParams.get('role')).toBe('cold_caller');
  await page.reload();
  await expect.poll(() => requests.filter(r => r.role === 'cold_caller').length).toBeGreaterThan(1);
  await page.getByRole('combobox', { name: 'Perfil profesional' }).selectOption('');
  await page.getByRole('button', { name: 'Ver oportunidades', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.role).toBeNull();
  expect(new URL(page.url()).search).toBe('');
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

test('un filtro estrecho con pocas ofertas se completa con el hueco ampliado, rotulado', async ({ page }) => {
  const closerOffers = Array.from({ length: 3 }, (_, i) => ({ ...offer, id: `closer-${i}` }));
  const widerOffers = Array.from({ length: 13 }, (_, i) => ({ ...offer, id: `wider-${i}`, role: 'account_executive', role_label: 'Ejecutivo comercial', original_title: 'AE comercial de ventas' }));
  await page.route('**/api/backend/opportunities/search', route => {
    const body = route.request().postDataJSON() as { role?: string | null };
    return route.fulfill({ json: body.role === 'closer' ? { items: closerOffers, total: 3 } : { items: [...closerOffers, ...widerOffers], total: 16 } });
  });
  await page.goto('/');
  expect(new URL(page.url()).search).toBe('');
  await page.getByRole('combobox', { name: 'Perfil profesional' }).selectOption('closer');
  await page.getByRole('combobox', { name: 'Desde dónde quieres trabajar' }).selectOption('ES');
  await page.getByRole('button', { name: 'Ver oportunidades', exact: true }).click();
  // La petición primaria conserva su filtro; el bucket ampliado va por separado
  await expect(page.getByText('3 con tu filtro · 13 más del catálogo con tu mercado')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Oportunidades para explorar/ }).locator('span')).toHaveText('16');
  await expect(page.locator('.wider-bucket').getByText('Ejecutivo comercial').first()).toBeVisible();
  // Las del bucket comparten ficha pero el filtro sigue activo en la URL
  expect(new URL(page.url()).searchParams.get('role')).toBe('closer');
  expect(new URL(page.url()).searchParams.get('market')).toBe('ES');
});
