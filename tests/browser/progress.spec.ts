import { test, expect } from '@playwright/test';

// Paneles de progreso: alumna («Mi progreso») y coordinadora («Alumnas»).
// Los datos llegan del servidor; aquí se simulan para comprobar los estados
// con datos, vacío y sin actividad, sin inventar métricas en la interfaz.

const profile = { full_name: 'Lucía', city: 'Madrid', target_roles: ['closer'], languages: ['es'], availability: '', video_url: '', consent_at: new Date().toISOString() };
const progress = {
  windowDays: 30,
  sessions: 3,
  lastSeen: '2026-10-23T09:00:00.000Z',
  practice: { count: 2, last: '2026-10-23T08:30:00.000Z', best: 78, average: 70 },
  training: { modules: ['precall', 'logica'], lastReview: '2026-10-22T18:00:00.000Z', examBest: 100, examPassed: true, examLast: '2026-10-22T19:00:00.000Z' },
  streak: 2,
  // Resumen sin ventana: aquí hay más historial que en los últimos 30 días.
  lifetime: {
    sessions: 8,
    lastSeen: '2026-09-30T09:00:00.000Z',
    practice: { count: 6, last: '2026-09-30T08:30:00.000Z', best: 88, average: 74 },
    training: { modules: ['precall', 'logica', 'descubrimiento', 'freezing', 'yellows', 'star', 'cierres'], lastReview: '2026-09-30T08:30:00.000Z', examBest: 100, examPassed: true, examLast: '2026-09-29T19:00:00.000Z' },
    streak: 4,
    axes: [],
    weeks: [],
    scenarios: [],
  },
  truncated: false,
  axes: [
    { id: 'apertura', label: 'Apertura y marco', average: 74, count: 2 },
    { id: 'descubrimiento', label: 'Descubrimiento', average: 62, count: 2 },
    { id: 'objecion', label: 'Objeciones', average: 48, count: 1 },
    { id: 'cierre', label: 'Cierre', average: 80, count: 2 },
  ],
  weeks: [
    { start: '2026-10-12', count: 1, average: 62 },
    { start: '2026-10-19', count: 1, average: 78 },
  ],
  scenarios: [
    { id: 'venta-fria', count: 2, average: 70, last: '2026-10-23T08:30:00.000Z' },
  ],
  recent: [
    { id: 'e1', kind: 'practice', ref: 'venta-fria', score: 78, detail: {}, created_at: '2026-10-23T08:30:00.000Z' },
    { id: 'e2', kind: 'practice', ref: 'venta-fria', score: 62, detail: {}, created_at: '2026-10-16T08:30:00.000Z' },
    { id: 'e3', kind: 'training_exam', ref: 'final', score: 100, detail: { passed: true }, created_at: '2026-10-22T19:00:00.000Z' },
    { id: 'e4', kind: 'session', ref: null, score: null, detail: {}, created_at: '2026-10-23T09:00:00.000Z' },
  ],
};
const emptyProgress = { windowDays: 30, sessions: 0, lastSeen: null, practice: { count: 0, last: null, best: null, average: null }, training: { modules: [], lastReview: null, examBest: null, examPassed: false, examLast: null }, streak: 0, axes: [], weeks: [], scenarios: [], recent: [], lifetime: { sessions: 0, lastSeen: null, practice: { count: 0, last: null, best: null, average: null }, training: { modules: [], lastReview: null, examBest: null, examPassed: false, examLast: null }, streak: 0, axes: [], weeks: [], scenarios: [] }, truncated: false };
// Ventana sin actividad, pero historial de siempre: los logros y la racha no se
// retiran al cambiar el periodo.
const lifetimeOnly = { ...emptyProgress, lifetime: progress.lifetime };

async function student(page: import('@playwright/test').Page, data: unknown) {
  await page.route('**/api/student/session', route => route.fulfill({ json: { configured: true, authenticated: true, email: 'lucia@alumna.dev' } }));
  await page.route('**/api/student/profile', route => route.fulfill({ json: { profile } }));
  await page.route('**/api/student/progress**', route => route.fulfill({ json: { progress: data } }));
  await page.route('**/api/student/matches', route => route.fulfill({ json: { ready: false, hint: 'Hoy no hay ofertas aprobadas.', matches: [] } }));
  await page.route('**/api/student/applications', route => route.fulfill({ json: { applications: [] } }));
  await page.route('**/api/student/application-profile', route => route.fulfill({ json: { profile: null, completeness: { pct: 0, missing: [] }, options: { work_authorization: {}, levels: {}, contracts: {}, answers: {} }, base_consent: true } }));
  await page.goto('/alumna');
  // `getByText` busca sin distinguir mayúsculas: «Cargando tu progreso…» también
  // coincide. Se pide el encabezado exacto del panel.
  await expect(page.getByText('TU PROGRESO', { exact: true })).toBeVisible();
}

test('la alumna ve su progreso real: entradas, práctica, competencias, evolución, racha y logros', async ({ page }) => {
  await student(page, progress);
  const panel = page.getByRole('region', { name: 'Mi progreso' });
  await expect(panel.getByText('última entrada')).toBeVisible();
  await expect(panel.getByText('prácticas terminadas')).toBeVisible();
  await expect(panel.getByText('mejor nota de práctica')).toBeVisible();
  await expect(panel.locator('.stat-strip strong').first()).not.toHaveText('—');
  await expect(panel.getByText('2 de 7 ejercicios')).toBeVisible();
  await expect(panel.getByText('Examen: 100/100 · superado')).toBeVisible();
  // Competencias: cada criterio con su media escrita y su recuento, no solo color.
  await expect(panel.getByText('Tus competencias')).toBeVisible();
  // El radar repite las etiquetas en SVG: se comprueba la barra, que lleva el dato escrito.
  await expect(panel.locator('.progress-axes').getByText('Apertura y marco', { exact: true })).toBeVisible();
  await expect(panel.locator('.progress-axis-top').filter({ hasText: 'Apertura y marco' }).locator('b')).toContainText('74');
  await expect(panel.getByText('1 práctica con este criterio')).toBeVisible();
  // Evolución semanal con la nota y las prácticas de cada semana.
  await expect(panel.getByText('Tu evolución')).toBeVisible();
  await expect(panel.locator('.progress-weeks .progress-week')).toHaveCount(2);
  // Foco: el criterio más bajo de sus propias notas.
  await expect(panel.getByText(/Tu criterio más bajo es/)).toBeVisible();
  await expect(panel.getByText(/Objeciones/).first()).toBeVisible();
  // Logros derivados de sus datos, sin inventar progreso.
  await expect(panel.getByText('Primera práctica')).toBeVisible();
  await expect(panel.getByText('Examen superado')).toBeVisible();
  await expect(panel.getByText('Cinco prácticas')).toBeVisible();
  // La racha y los logros salen de toda la actividad (6 prácticas, 4 días), no de
  // la ventana de 30 días (2 prácticas, 2 días): cambiar el periodo no los retira.
  await expect(panel.locator('.stat-strip span').filter({ hasText: 'días seguidos' }).locator('strong')).toHaveText('4');
  await expect(panel.locator('.progress-achievements li[data-done="true"]').filter({ hasText: 'Cinco prácticas' })).toBeVisible();
  await expect(panel.getByText('Práctica: Llamada en frío a una directora de marketing').first()).toBeVisible();
  await expect(panel.getByText('Examen de egreso')).toBeVisible();
  // La nota nunca se presenta como oficial.
  await expect(panel.getByText(/no es una certificación oficial/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('el periodo se puede cambiar a 90 días y la petición lo lleva', async ({ page }) => {
  const requested: string[] = [];
  await student(page, progress);
  page.on('request', request => { if (request.url().includes('/api/student/progress')) requested.push(request.url()); });
  const panel = page.getByRole('region', { name: 'Mi progreso' });
  await panel.getByRole('button', { name: '90 días' }).click();
  await expect(panel.getByRole('button', { name: '90 días' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => requested.some(url => url.includes('days=90'))).toBe(true);
});

test('una ventana sin actividad no borra los logros ni dice «aún no hay actividad»', async ({ page }) => {
  await student(page, lifetimeOnly);
  const panel = page.getByRole('region', { name: 'Mi progreso' });
  await expect(panel.getByText('Aún no hay actividad en tu cuenta.')).toHaveCount(0);
  await expect(panel.locator('.stat-strip span').filter({ hasText: 'días seguidos' }).locator('strong')).toHaveText('4');
  await expect(panel.locator('.progress-achievements li[data-done="true"]').filter({ hasText: 'Formación completa' })).toBeVisible();
  await expect(panel.getByText('Sin prácticas con nota en estos 30 días.')).toBeVisible();
});

test('sin actividad se dice «aún no hay», no se pintan ceros ni notas 0', async ({ page }) => {
  await student(page, emptyProgress);
  const panel = page.getByRole('region', { name: 'Mi progreso' });
  await expect(panel.getByText('Aún no hay actividad en tu cuenta.')).toBeVisible();
  await expect(panel.locator('.stat-strip').getByText('0', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('mejor nota de práctica')).toBeVisible();
  await expect(panel.getByText('0/100')).toHaveCount(0);
});
