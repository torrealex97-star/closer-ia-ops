import Workspace from '../../components/Workspace';
import AdminShell from '../../components/AdminShell';

// El modo local sigue montando el panel completo local (backend FastAPI en la Mac);
// con CAREER_ENGINE_URL (Vercel/hosted) la /admin es el panel contra el engine cloud, tras
// el acceso por email + contraseña de Supabase Auth (solo usuarios invitados).
// Se decide al servir (no al compilar): el modo depende de las variables del despliegue.
export const dynamic = 'force-dynamic';
export default function Page() {
  return process.env.CAREER_ENGINE_URL ? <AdminShell /> : <Workspace />;
}
