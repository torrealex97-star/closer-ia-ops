// Detección de IP literal SIN `node:net`: la comprobación tiene que valer igual en Node y en workerd.
// Devuelve 0 si no es una IP, 4 si es IPv4 y 6 si es IPv6 (misma forma que `net.isIP`).
export function isIP(value: string): 0 | 4 | 6 {
  const v = value.trim().replace(/^\[|\]$/g, '');
  if (!v) return 0;
  if (v.includes(':')) return isIPv6(v) ? 6 : 0;
  return isIPv4(v) ? 4 : 0;
}

function isIPv4(v: string): boolean {
  const parts = v.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function isIPv6(v: string): boolean {
  // ::1, ::, fe80::1, 2001:db8::8, ::ffff:127.0.0.1
  if (!/^[0-9a-f:.]+$/i.test(v)) return false;
  if (v.includes('.')) {
    // Forma mixta: la parte final es una IPv4 y el resto, hexadecimal.
    const at = v.lastIndexOf(':');
    if (at < 0) return false;
    const tail = v.slice(at + 1);
    if (isIPv4(tail)) return v.slice(0, at + 1).split(':').every(g => g === '' || /^[0-9a-f]{1,4}$/i.test(g));
  }
  const groups = v.split('::');
  if (groups.length > 2) return false;
  const count = (s: string) => (s ? s.split(':').filter(Boolean).length : 0);
  const hexOK = (s: string) => s.split(':').filter(Boolean).every(g => /^[0-9a-f]{1,4}$/i.test(g));
  if (groups.length === 2) return hexOK(`${groups[0]}:`) && hexOK(`:${groups[1]}`) && count(groups[0]) + count(groups[1]) <= 7;
  return count(groups[0]) === 8 && hexOK(groups[0]);
}
