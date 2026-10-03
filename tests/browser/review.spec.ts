import { test, expect } from '@playwright/test';

// fixtures — same shape as the API contract (v1 literal + unknowns explicit).
const draftItem = {
  id: 'opp-review-test', job_id: 'job-review-test', version: 1, editorial_status: 'draft',
  opportunity_status: 'verifying', status_reason: null, connection_type: 'external_application',
  locale: 'es', last_verified_at: null, verified_until: null,
  version_payload: {
    headline: 'Closer de ventas', role: 'Closer de ventas', short_summary: '',
    what_they_are_looking_for: [], what_you_would_do: [], why_it_may_be_interesting: [],
    compensation_summary: 'No especificado', location_summary: 'España', experience_summary: 'No especificado',
    language_requirements: [], application_type: 'external_platform', application_url: 'https://empleo.example.com/oferta',
    next_step: { action: 'view_process', label: 'Ver proceso de candidatura', destination_label: 'Publicación original', destination_domain: 'empleo.example.com', requires_account: null, enabled: false, disabled_reason: 'Revisión editorial pendiente' },
    field_provenance: {}, selection_method: 'deterministic_rule', selection_policy_version: '1',
  },
  eligibility: { employer_country: 'España', customer_markets: [], allowed_worker_countries: [], excluded_worker_countries: [], residency_required: true, work_authorization_requirements: 'Documentación en regla', timezone_overlap: null, backfilled: true },
  job_snapshot: { title: 'Closer de ventas', company: 'Empresa de prueba', description: 'Buscamos closer remoto', source_url: 'https://empleo.example.com/oferta', locations: ['España'], published_at: '2026-09-29T10:00:00+00:00', source: 'Himalayas' },
};

test('editorial review: list, edit summary, approve with review endpoint', async ({ page }) => {
  let reviewBody: Record<string, unknown> | null = null;
  await page.route('**/api/backend/wdc/opportunities**', async route => {
    if (route.request().method() === 'POST') {
      reviewBody = route.request().postDataJSON();
      await route.fulfill({ json: { ...draftItem, editorial_status: 'approved', version: 2 } });
      return;
    }
    await route.fulfill({ json: { items: [draftItem], total: 1 } });
  });
  await page.route('**/api/backend/wdc/opportunities/opp-review-test', route => route.fulfill({ json: draftItem }));

  await page.goto('/admin');
  await page.getByRole('button', { name: 'Revisión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Revisar antes de ofrecer.' })).toBeVisible();
  await expect(page.getByText('Closer de ventas').first()).toBeVisible();

  await page.getByRole('button', { name: /Closer de ventas/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Trazabilidad del borrador')).toBeVisible();
  await expect(dialog.getByText('residencia exigida: sí')).toBeVisible();

  await dialog.getByLabel('Resumen corto').fill('Closer remota para empresa de prueba, con residencia en España.');
  await dialog.getByRole('button', { name: 'Aprobar' }).click();

  expect(reviewBody).toMatchObject({ editorial_status: 'approved', locale: 'es', reviewed_by: 'admin-local' });
  const payload = (reviewBody as { version_payload: Record<string, unknown> }).version_payload;
  expect(payload.short_summary).toContain('Closer remota');
  await expect(page.getByText('Oportunidad aprobada.')).toBeVisible();
});

test('guard messages from the backend surface in the panel', async ({ page }) => {
  await page.route('**/api/backend/wdc/opportunities**', async route => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 422, json: { detail: 'No se publica sin modalidad de candidatura determinada; usa needs_review' } });
      return;
    }
    await route.fulfill({ json: { items: [draftItem], total: 1 } });
  });
  await page.route('**/api/backend/wdc/opportunities/opp-review-test', route => route.fulfill({ json: draftItem }));

  await page.goto('/admin');
  await page.getByRole('button', { name: 'Revisión', exact: true }).click();
  await page.getByRole('button', { name: /Closer de ventas/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('No se publica sin modalidad de candidatura determinada; usa needs_review')).toBeVisible();
});

test('verify button runs the vigencia check and shows verdict with validity window', async ({ page }) => {
  await page.route('**/api/backend/wdc/opportunities**', route => route.fulfill({ json: { items: [draftItem], total: 1 } }));
  // Registrado después: Playwright da prioridad al último route registrado.
  await page.route('**/api/backend/wdc/opportunities/opp-review-test/verify', async route => {
    expect(route.request().method()).toBe('POST');
    await route.fulfill({ json: {
      result: 'open', method: 'http_status_content_v1', checked_at: '2026-10-01T10:00:00+00:00',
      valid_until: '2026-10-03T10:00:00+00:00', reason_code: 'content_matches', evidence_raw_id: 'raw-1',
      opportunity_status: 'active', next_step_enabled: true, status_reason: 'Verificado activa (http_status_content_v1)',
    } });
  });
  await page.route('**/api/backend/wdc/opportunities/opp-review-test', route => route.fulfill({ json: draftItem }));

  await page.goto('/admin');
  await page.getByRole('button', { name: 'Revisión', exact: true }).click();
  await page.getByRole('button', { name: /Closer de ventas/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Verificar vigencia' }).click();
  const verdictTag = dialog.locator('[data-verification="open"]');
  await expect(verdictTag).toContainText('Activa en el origen · content_matches');
  await expect(verdictTag).toContainText('vigente hasta');
});
