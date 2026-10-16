import type { Metadata } from 'next';
import './globals.css';
import RecoveryRedirect from '../components/RecoveryRedirect';
export const metadata: Metadata = {
  title: 'Closer IA OPs',
  description: 'Encuentra y selecciona oportunidades profesionales para tus alumnas.',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="es"><body><RecoveryRedirect />{children}</body></html>;
}
