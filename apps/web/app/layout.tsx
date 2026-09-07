import type { Metadata } from 'next';
import { JetBrains_Mono, Manrope, Source_Serif_4 } from 'next/font/google';
import './globals.css';
// Importing this for its module-level side effect: it validates process.env at import
// time (see lib/env.ts), and the root layout is the one module every request loads, so
// this is where "fail fast on a bad env var" actually gets wired into the app's boot path.
import '@/lib/env';
import { Providers } from './providers';

const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-source-serif',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Fomo (working title)',
  description: 'A social crypto discovery and trading platform — foundation build.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}>
      <body className="font-body antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
