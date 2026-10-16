import type { NextConfig } from 'next';

// Cabeceras de seguridad para todo el sitio. Sin CSP estricta: Next inyecta scripts en línea y exigiría nonces.
const headers = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async headers() { return [{ source: '/:path*', headers }]; },
};
export default config;
