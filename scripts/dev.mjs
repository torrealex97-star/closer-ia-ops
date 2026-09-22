import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.CAREER_PYTHON || resolve(root, '.venv/bin/python');
if (!existsSync(python)) throw new Error('Ejecuta primero la instalación Python indicada en README.md');
const env = { ...process.env, CAREER_LOCAL_TOKEN: randomBytes(32).toString('hex'),
  PYTHONPATH: [resolve(root, 'apps/api'), process.env.PYTHONPATH].filter(Boolean).join(':') };
mkdirSync(resolve(root, '.local'), { recursive: true });
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
function start(command, args) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 1); });
  return child;
}
start(python, ['-m', 'uvicorn', 'career.main:app', '--host', '127.0.0.1', '--port', '8100']);
start(python, ['-m', 'career.worker']);
start('npm', ['run', 'dev', '-w', 'apps/web']);
writeFileSync(resolve(root, '.local/processes.json'), JSON.stringify({ launcher: process.pid, children: children.map(c => c.pid) }));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log('\nWDC Oportunidades → http://127.0.0.1:3100\n');
