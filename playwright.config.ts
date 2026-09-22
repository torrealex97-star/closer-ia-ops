import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/browser', use: { baseURL: 'http://127.0.0.1:3100', headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined, launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined } }, timeout: 30000 });
