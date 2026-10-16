import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// Cifrado de claves de proveedores (AES-256-GCM). La clave de cifrado sale de ADMIN_SECRETS_KEY o, si no
// existe, se deriva de la service role de Supabase: rotar esa clave obliga a volver a pegar las de proveedores.
const key = () => {
  const root = process.env.ADMIN_SECRETS_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!root) throw new Error('Sin clave de cifrado configurada');
  return Buffer.from(hkdfSync('sha256', root, 'wdc-admin', 'integration-secrets-v1', 32));
};

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(b => b.toString('base64')).join('.');
}

export function decryptSecret(stored: string): string {
  const [iv, tag, body] = stored.split('.').map(p => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
