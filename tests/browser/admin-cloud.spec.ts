import { test, expect, type Page, type Route } from '@playwright/test';

// Panel de administración contra el engine cloud (CloudAdminPanel). El servidor
// solo monta ese panel cuando tiene CAREER_ENGINE_URL, así que este spec exige un
// servidor arrancado con esa variable y WDC_CLOUD_ADMIN=1. Sin ello se omite
// explícitamente: el spec local de /admin ya cubre el panel de modo local.
//   CAREER_ENGINE_URL=https://<engine> npm run dev -w apps/web   (puerto 3100)
//   WDC_CLOUD_ADMIN=1 PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/admin-cloud.spec.ts
//
// Las llamadas del navegador a /api/admin/* se interceptan aquí: el token del engine
// nunca llega al cliente y no se usa en estas pruebas. La contraseña es un fixture;
// la comprobación real del password la cubre la ruta de sesión en el servidor.
test.skip(process.env.WDC_CLOUD_ADMIN !== '1', 'requiere servidor con CAREER_ENGINE_URL y WDC_CLOUD_ADMIN=1');

const OPERATOR_PASSWORD = 'fixture-operator-password';

const draftItem = {
  id: 'opp-cloud-test', job_id: 'job-cloud-test', original_title: 'Closer de ventas', company: 'Empresa de prueba',
  source_url: 'https://empleo.example.com/oferta', source: 'Himalayas', editorial_status: 'draft',
  opportunity_status: 'verifying', connection_type: 'external_application',
  created_at: '2026-09-29T10:00:00+00:00', updated_at: '2026-09-29T10:00:00+00:00',
};

const detail = {
  ...draftItem, version: 1, status_reason: null, locale: 'es', last_verified_at: null, verified_until: null,
  version_payload: {
    headline: 'Closer de ventas', role: 'closer', short_summary: '',
    what_they_are_looking_for: [], what_you_would_do: [], why_it_may_be_interesting: [],
    compensation_summary: 'No especificado', location_summary: 'España', experience_summary: 'No especificado',
    language_requirements: [], application_type: 'external_platform', application_url: 'https://empleo.example.com/oferta',
    next_step: { action: 'view_process', label: 'Ver proceso de candidatura', enabled: false, disabled_reason: 'Revisión editorial pendiente' },
  },
  job_snapshot: { title: 'Closer de ventas', company: 'Empresa de prueba', location: 'España', salary: null, posted_at: null, source_url: 'https://empleo.example.com/oferta', source: 'Himalayas', description: 'Buscamos closer remoto' },
  vigencia: { expires_at: null, activa: false },
  verificacion: { last_verified_at: null, verified_until: null, status_reason: null },
};

const verification = {
  result: 'open', method: 'http_status_content_v1', checked_at: '2026-10-01T10:00:00+00:00',
  valid_until: '2026-10-03T10:00:00+00:00', reason_code: 'content_matches', evidence_raw_id: 'raw-1',
  opportunity_status: 'active', next_step_enabled: true, status_reason: 'Verificado activa (http_status_content_v1)',
};

type Mock = { loggedIn: boolean; patchBody: Record<string, unknown> | null; patchStatus: number; patchDetail: string | null };

async function mockAdmin(page: Page, options: { patchStatus?: number; patchDetail?: string } = {}): Promise<Mock> {
  const state: Mock = { loggedIn: false, patchBody: null, patchStatus: options.patchStatus ?? 200, patchDetail: options.patchDetail ?? null };
  await page.route('**/api/admin/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/admin/session') {
      if (request.method() === 'GET') return route.fulfill({ json: { configured: true, authenticated: state.loggedIn } });
      if (request.method() === 'POST') {
        const password = (request.postDataJSON() as { password?: string }).password;
        if (password !== OPERATOR_PASSWORD) return route.fulfill({ status: 401, json: { detail: 'Contraseña incorrecta.' } });
        state.loggedIn = true;
        return route.fulfill({ json: { authenticated: true } });
      }
      if (request.method() === 'DELETE') { state.loggedIn = false; return route.fulfill({ json: { authenticated: false } }); }
    }
    if (!state.loggedIn) return route.fulfill({ status: 401, json: { detail: 'Sesión de operador requerida.' } });
    if (path === '/api/admin/opportunities' && request.method() === 'GET') {
      return route.fulfill({ json: { items: [draftItem], total: 1, counts: { draft: 1 } } });
    }
    if (path === '/api/admin/opportunities/opp-cloud-test/verify' && request.method() === 'POST') {
      return route.fulfill({ json: verification });
    }
    if (path === '/api/admin/opportunities/opp-cloud-test' && request.method() === 'GET') {
      return route.fulfill({ json: detail });
    }
    if (path === '/api/admin/opportunities/opp-cloud-test' && request.method() === 'PATCH') {
      state.patchBody = request.postDataJSON();
      if (state.patchStatus !== 200) return route.fulfill({ status: state.patchStatus, json: { detail: state.patchDetail } });
      return route.fulfill({ json: { version: 2 } });
    }
    return route.fulfill({ status: 404, json: { detail: `sin mock: ${request.method()} ${path}` } });
  });
  return state;
}

async function login(page: Page) {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Panel de administración' })).toBeVisible();
  await page.getByLabel('Contraseña').fill(OPERATOR_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /Closer de ventas/ })).toBeVisible();
}

test('login: wrong password shows error, correct password opens the review list', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('/admin');
  await page.getByLabel('Contraseña').fill('wrong-password');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('div.alert.error')).toHaveText('Contraseña incorrecta.');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();

  await page.getByLabel('Contraseña').fill(OPERATOR_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /Closer de ventas/ })).toBeVisible();
});

test('editorial review: edit summary and approve through PATCH with version notice', async ({ page }) => {
  const state = await mockAdmin(page);
  await login(page);
  expect(state.loggedIn).toBe(true);

  await page.getByRole('button', { name: /Closer de ventas/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Closer de ventas' })).toBeVisible();
  await dialog.getByLabel('Resumen corto').fill('Closer remota para empresa de prueba, con residencia en España.');
  await dialog.getByRole('button', { name: 'Aprobar' }).click();

  await expect(page.getByText('Guardado: Aprobada · versión 2 creada.')).toBeVisible();
  expect(state.patchBody).toMatchObject({ editorial_status: 'approved', locale: 'es', reviewed_by: 'admin-web' });
  const payload = (state.patchBody as { version_payload: Record<string, unknown> }).version_payload;
  expect(payload.short_summary).toContain('Closer remota');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('guard messages from the engine surface in the cloud panel', async ({ page }) => {
  await mockAdmin(page, { patchStatus: 422, patchDetail: 'No se publica sin modalidad de candidatura determinada; usa needs_review' });
  await login(page);
  await page.getByRole('button', { name: /Closer de ventas/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar' }).click();
  await expect(page.locator('div.alert.error')).toHaveText('No se publica sin modalidad de candidatura determinada; usa needs_review');
});

test('verify button shows the engine verdict with validity and CTA state', async ({ page }) => {
  await mockAdmin(page);
  await login(page);
  await page.getByRole('button', { name: /Closer de ventas/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Verificar vigencia' }).click();
  await expect(dialog.getByRole('status')).toContainText('Activa en el origen · content_matches');
  await expect(dialog.getByRole('status')).toContainText('vigente hasta');
  await expect(dialog.getByRole('status')).toContainText('CTA habilitado');
});

test('logout returns to the login form and blocks the review list', async ({ page }) => {
  await mockAdmin(page);
  await login(page);
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Closer de ventas/ })).toHaveCount(0);
});
