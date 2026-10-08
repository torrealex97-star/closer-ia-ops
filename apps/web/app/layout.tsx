import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Closer IA OPs',
  description: 'Encuentra y selecciona oportunidades profesionales para tus alumnas.',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="es"><body>{children}</body></html>;
}
