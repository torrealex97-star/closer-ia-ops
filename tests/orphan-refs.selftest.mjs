// Prueba negativa del chequeo: node tests/orphan-refs.selftest.mjs
import assert from 'node:assert/strict';
import { apiRefs, missingFiles, missingRoutes } from './orphan-refs.mjs';

const patterns = [['student', 'profile'], ['admin', '[...path]'], ['student', 'auth', 'recover'], ['apify', 'webhook']];
const text = "await call('/api/student/profile'); await call('/api/student/progress', x); fetch(`/api/admin/anything/deep?x=1`); call('/api/student/auth/recover', {}); call(\"/api/apify/webhook\")";
assert.deepEqual(apiRefs(text).sort(), ['/api/admin/anything/deep', '/api/apify/webhook', '/api/student/auth/recover', '/api/student/profile', '/api/student/progress']);
assert.deepEqual(missingRoutes(text, patterns), ['/api/student/progress'], 'solo la ruta inexistente se señala; [...path] cubre todo lo que cuelga');
assert.deepEqual(missingRoutes("call('/api/student/profile')", patterns), []);
assert.deepEqual(missingFiles('node tests/admin-auth/activity.mjs && bash tests/x/run.sh', path => path === 'tests/x/run.sh'), ['tests/admin-auth/activity.mjs']);
assert.deepEqual(missingFiles('echo hola', () => false), []);
console.log('PASS  chequeo de referencias huérfanas: detecta lo que falta y no da falsos positivos');
