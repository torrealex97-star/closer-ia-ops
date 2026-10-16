'use client';
import { useEffect } from 'react';

// Si el enlace de recuperación de Supabase aterriza fuera de /admin/reset (p. ej. por la URL del sitio
// configurada en Supabase), lo lleva a la pantalla de contraseña conservando el token del #.
export default function RecoveryRedirect() {
  useEffect(() => {
    const { hash, pathname } = window.location;
    if (pathname !== '/admin/reset' && /access_token=/.test(hash) && /type=recovery/.test(hash)) {
      window.location.replace(`/admin/reset${hash}`);
    }
  }, []);
  return null;
}
