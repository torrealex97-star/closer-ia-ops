import { test, expect } from '@playwright/test';

test('operator can configure search, inspect sources and use mobile navigation', async ({ page }) => {
  await page.route('**/api/backend/source-connections', route => route.fulfill({ json: [] }));
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Su próximo paso empieza aquí.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buscar oportunidades', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Perfil profesional' }).selectOption('closer');
  await page.getByRole('combobox', { name: 'Mercado', exact: true }).selectOption('ES');
  await page.getByText('Afinar búsqueda', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Idioma mencionado' }).selectOption('es');
  await expect(page.getByLabel('Incluir país o fecha sin confirmar')).toBeChecked();
  await expect(page.getByLabel('Exigir evidencia de español (incluye bilingües)')).toBeChecked();
  await page.getByRole('button', { name: 'Red de oportunidades', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Himalayas', exact: true })).toBeVisible();
  // El catálogo público crece con cada incremento: cada fuente conectada lleva su badge.
  const config = await (await page.request.get('/api/backend/config')).json();
  await expect(page.getByText('API pública activa', { exact: true })).toHaveCount(config.sources.filter((s: { available: boolean; category: string }) => s.available && s.category !== 'Mis conexiones').length);
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
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Red de oportunidades', exact: true }).click();
  await page.getByLabel('Buscar fuente').fill('InfoJobs');
  await page.getByRole('button', { name: 'Conectar', exact: true }).click();
  await page.getByRole('button', { name: 'Necesito una configuración avanzada' }).click();
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


test('guided setup needs no actor IDs or JSON and saves a server plan', async ({ page }) => {
  await page.route('**/api/backend/source-assistant/prepare', async route => {
    expect(route.request().postDataJSON().source).toBe('infojobs');
    expect(route.request().postDataJSON().max_items).toBe(25);
    await route.fulfill({ json: { id: 'test-plan', actor_title: 'InfoJobs preparado', actor_url: 'https://apify.com/haketa/infojobs-scraper', pricing_model: 'PAY_PER_EVENT', connection: { name: 'InfoJobs', max_items: 25, max_charge_usd: 1 }, message: 'Configuración preparada.' } });
  });
  let accepted = false;
  await page.route('**/api/backend/source-assistant/connect', async route => {
    expect(route.request().postDataJSON()).toEqual({ plan_id: 'test-plan' });
    accepted = true;
    await route.fulfill({ json: { id: 'guided-test' } });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Red de oportunidades', exact: true }).click();
  await page.getByLabel('Buscar fuente').fill('InfoJobs');
  await page.getByRole('button', { name: 'Conectar', exact: true }).click();
  await expect(page.getByLabel('Actor ID', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Input adicional del Actor · JSON')).toHaveCount(0);
  await page.getByRole('button', { name: '3. Preparar mi fuente' }).click();
  await expect(page.getByRole('link', { name: 'InfoJobs preparado ↗', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Guardar fuente preparada' }).click();
  await expect(page.getByRole('region', { name: 'Asistente de fuente' })).toHaveCount(0);
  expect(accepted).toBe(true);
  await page.getByText('Motor de IA', { exact: false }).first().click();
  await expect(page.getByLabel('Clave de Groq')).toBeVisible();
  await expect(page.getByLabel('Análisis nuevos por día (UTC)')).toHaveValue('20');
});


test('offer AI analysis displays persisted result and token usage', async ({ page }) => {
  const job = { id: 'job-ui', title: 'Closer digital', company: 'Empresa fixture', description: 'Trabajo remoto. Buscamos ventas para nuestro equipo.', source: 'Fixture', source_url: 'https://example.com/jobs/1', application_url: 'https://example.com/jobs/1', locations: ['Spain'], published_at: new Date().toISOString(), salary_min: null, salary_max: null, salary_currency: null, salary_period: null, score: 75, reasons: ['Perfil mencionado'], warnings: [], raw_id: 'raw-ui', captured_at: new Date().toISOString(), provider: 'fixture', starred: false };
  const run = { id: 'run-ui', query: { role: 'digital_sales', market: 'ES', days: 30 }, status: 'completed', created_at: new Date().toISOString(), sources: [], jobs: [job] };
  const analysis = { id: 'analysis-ui', status: 'completed', model: 'gpt-4.1-mini', usage: { input_tokens: 400, output_tokens: 90 }, result: { summary: 'Cierre comercial en remoto.', fit: 'alineada', confidence: 'media', requirements: ['Experiencia en ventas'], questions: ['Confirmar comisiones'], evidence: 'Trabajo remoto.' } };
  let requested = false;
  await page.route('**/api/backend/search-runs', route => route.fulfill({ json: [{ ...run, jobs: [] }] }));
  await page.route('**/api/backend/search-runs/run-ui', route => route.fulfill({ json: run }));
  await page.route('**/api/backend/ai/jobs/job-ui', route => route.fulfill({ json: requested ? analysis : null }));
  await page.route('**/api/backend/ai/analyses', route => { requested = true; return route.fulfill({ json: analysis }); });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Historial', exact: true }).click();
  await page.locator('.history-row').first().click();
  await page.getByRole('button', { name: 'Closer digital', exact: true }).click();
  await page.getByRole('button', { name: 'Analizar esta oferta con IA' }).click();
  await expect(page.getByText('Cierre comercial en remoto.')).toBeVisible();
  await expect(page.getByText(/400 tokens de entrada \/ 90 de salida/)).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar detalle' }).click();
  await page.getByRole('button', { name: 'Closer digital', exact: true }).click();
  await expect(page.getByText('Cierre comercial en remoto.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analizar esta oferta con IA' })).toHaveCount(0);
});

test('Groq is visible and switching provider never carries the typed key', async ({ page }) => {
  await page.route('**/api/backend/integrations/ai*', async route => {
    const provider = new URL(route.request().url()).searchParams.get('provider') || 'groq';
    const config = { provider, enabled: false, has_token: false, model: provider === 'groq' ? 'openai/gpt-oss-20b' : 'gpt-4.1-mini', daily_limit: 20, used_today: 0, max_input_characters: 6000, max_output_tokens: provider === 'groq' ? 900 : 600 };
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.provider).toBe('groq');
      expect(body.token).toBe('');
      await route.fulfill({ json: { ...config, ...body, has_token: false } });
    } else await route.fulfill({ json: config });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Red de oportunidades', exact: true }).click();
  await page.getByText('Motor de IA · Groq', { exact: false }).first().click();
  await expect(page.getByLabel('Proveedor de IA')).toHaveValue('groq');
  await page.getByLabel('Clave de Groq').fill('never-send-to-openai');
  await page.getByLabel('Proveedor de IA').selectOption('openai');
  await expect(page.getByLabel('Clave de OpenAI')).toHaveValue('');
  await page.getByLabel('Proveedor de IA').selectOption('groq');
  await expect(page.getByLabel('Clave de Groq')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Comprobar IA', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Guardar motor de IA' }).click();
  await expect(page.getByRole('status')).toContainText('Conexión guardada');
});

test('a late initial load never overrides the provider the operator picked', async ({ page }) => {
  // Carrera real del panel, reproducida a voluntad: la lectura inicial del motor de IA (sin `provider`) tarda
  // más que el cambio de proveedor. Antes, esa respuesta tardía devolvía el selector a Groq con la clave ya
  // escrita delante, así que la clave parecía «borrarse sola» y el rótulo dejaba de corresponder al desplegable
  // (medido con un depurador: el selector volvía a Groq entre 300 y 600 ms después de entregarse la respuesta).
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let delivered = false;
  const config = (provider: string) => ({ provider, enabled: false, has_token: false, model: provider === 'groq' ? 'openai/gpt-oss-20b' : 'gpt-4.1-mini', daily_limit: 20, used_today: 0, max_input_characters: 6000, max_output_tokens: provider === 'groq' ? 900 : 600 });
  await page.route('**/api/backend/integrations/ai*', async route => {
    const provider = new URL(route.request().url()).searchParams.get('provider');
    if (!provider) { await held; const result = await route.fulfill({ json: config('groq') }); delivered = true; return result; }
    await route.fulfill({ json: config(provider) });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Red de oportunidades', exact: true }).click();
  await page.getByText('Motor de IA · Groq', { exact: false }).first().click();
  await page.getByLabel('Proveedor de IA').selectOption('openai');
  await expect(page.getByLabel('Clave de OpenAI')).toBeVisible();
  release();
  await expect.poll(() => delivered, { message: 'la respuesta tardía se entrega' }).toBe(true);
  // La afirmación es que NO cambia nada, así que hay que darle al navegador el margen en el que antes cambiaba:
  // soltar la respuesta y mirar de inmediato pasaría siempre, con o sin arreglo.
  await page.waitForTimeout(1200);
  await expect(page.getByLabel('Proveedor de IA')).toHaveValue('openai');
  await expect(page.getByLabel('Clave de OpenAI')).toBeVisible();
  await expect(page.getByLabel('Clave de OpenAI')).toHaveValue('');
});

test('daily collection budget controls are separate from saved catalog search', async ({ page }) => {
  let settings = { enabled: true, daily_budget_eur: 1, hour: 8 };
  const summary = () => ({ settings, timezone: 'Europe/Madrid', retention_days: 10, catalog_total: 6, added_last_24h: 2, reserved_eur: 0.25, actual_usd: 0.03, uncertain_runs: 0, latest: null });
  await page.route('**/api/backend/collection', route => route.fulfill({ json: summary() }));
  await page.route('**/api/backend/collection/settings', route => {
    expect(route.request().method()).toBe('PUT');
    settings = route.request().postDataJSON();
    return route.fulfill({ json: summary() });
  });
  await page.route('**/api/backend/source-connections', route => route.fulfill({ json: [] }));
  let collectionRequests = 0;
  await page.route('**/api/backend/collection/refresh', route => { collectionRequests++; return route.fulfill({ json: summary() }); });
  let searches = 0;
  await page.route('**/api/backend/search-runs', route => {
    if (route.request().method() === 'POST') {
      searches++;
      const query = route.request().postDataJSON().query;
      expect(query.days).toBe(10);
      return route.fulfill({ json: { id: 'catalog-fixture', query, status: 'completed', created_at: new Date().toISOString(), sources: [], jobs: [] } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/admin');
  await expect(page.getByText('6 en catálogo')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Publicación', exact: true })).toHaveValue('10');
  await page.getByRole('button', { name: 'Buscar oportunidades', exact: true }).click();
  expect(searches).toBe(1);
  expect(collectionRequests).toBe(0);
  await page.getByRole('button', { name: 'Red de oportunidades', exact: true }).click();
  await page.getByLabel('Presupuesto diario de scraping').selectOption('2');
  await page.getByLabel('Hora de recogida · Madrid').selectOption('9');
  await page.getByLabel('Recoger ofertas cada día').uncheck();
  await page.getByRole('button', { name: 'Guardar recogida diaria' }).click();
  await expect(page.getByText('Recogida automática pausada')).toBeVisible();
  expect(settings).toEqual({ enabled: false, daily_budget_eur: 2, hour: 9 });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('WDC workbook searches are available in the source assistant without executing scrapers', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Red de oportunidades', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir fuente', exact: true }).click();
  await page.getByLabel('1. ¿Dónde quieres buscar?').selectOption('facebook');
  await expect(page.getByLabel('Búsquedas y comunidades de WDC')).toBeVisible();
  await expect(page.getByLabel('Búsquedas y comunidades de WDC').locator('option')).toHaveCount(28);
  await expect(page.getByLabel('2. Pega enlaces de búsqueda o páginas')).toHaveValue(/facebook.com\/groups/);
  await page.getByLabel('1. ¿Dónde quieres buscar?').selectOption('infojobs');
  await expect(page.getByLabel('2. Pega enlaces de búsqueda o páginas')).toHaveValue(/teleworkingIds=2/);
  await expect(page.getByLabel('2. Pega enlaces de búsqueda o páginas')).not.toHaveValue(/page=3/);
});
