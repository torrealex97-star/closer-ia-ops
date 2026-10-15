import Workspace from '../../components/Workspace';
import CloudAdminPanel from '../../components/CloudAdminPanel';

// El modo local sigue montando el panel completo local (backend FastAPI en la Mac);
// con CAREER_ENGINE_URL (Vercel/hosted) la /admin pasa a ser el panel contra el
// engine cloud: sesión del operador + /api/admin/* con token inyectado server-side.
export default function Page() {
  return process.env.CAREER_ENGINE_URL ? <CloudAdminPanel /> : <Workspace />;
}
