import { Surface } from '@fomo/ui';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <Surface className="w-full p-8">
        <h1 className="font-display text-lg font-bold text-ink-900">Page not found</h1>
        <p className="mt-2 text-sm text-ink-600">There&apos;s nothing here yet.</p>
        <Link href="/" className="mt-6 inline-block text-sm font-semibold text-accent hover:underline">
          Back home
        </Link>
      </Surface>
    </main>
  );
}
