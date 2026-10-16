// Permite importar módulos .ts sin extensión (como hace Next) desde los tests de node:
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs <test.mjs>
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (/^\\.{1,2}\\//.test(specifier) && !/\\.[cm]?[jt]s$|\\.json$/.test(specifier)) {
      try { return await next(specifier + '.ts', context); } catch { /* sin .ts: sigue */ }
    }
    return next(specifier, context);
  }
`), import.meta.url);
