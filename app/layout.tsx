import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Prime Technical Intraday Scanner', description: '09:20 F&O intraday ranking dashboard' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
