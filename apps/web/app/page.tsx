import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import StudentOpportunities from '../components/StudentOpportunities';
import { authenticateStudent, studentLoginRequired } from '../lib/studentAuth';

export const dynamic = 'force-dynamic';
// Con CAREER_ENGINE_URL (Vercel/hosted) la alumna guarda en SU navegador
// (sin mutación del catálogo compartido — fix audit run-1 finding 2); el modo
// local de preview mantiene el marcador compartido del operador.
// Con STUDENT_LOGIN_REQUIRED=true la vista exige sesión de alumna (si no, redirige a /alumna).
export default async function Page() {
  if (studentLoginRequired()) {
    const jar = await cookies();
    const auth = await authenticateStudent({ cookies: { get: (n: string) => jar.get(n) } });
    if (!auth.ok) redirect('/alumna');
  }
  return <StudentOpportunities hosted={Boolean(process.env.CAREER_ENGINE_URL)} />;
}
