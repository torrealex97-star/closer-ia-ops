import StudentOpportunities from '../components/StudentOpportunities';
// Con CAREER_ENGINE_URL (Vercel/hosted) la alumna guarda en SU navegador
// (sin mutación del catálogo compartido — fix audit run-1 finding 2); el modo
// local de preview mantiene el marcador compartido del operador.
export default function Page() {
  return <StudentOpportunities hosted={Boolean(process.env.CAREER_ENGINE_URL)} />;
}
