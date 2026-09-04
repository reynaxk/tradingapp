'use client';

import { Button, Surface } from '@fomo/ui';
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Unhandled route error', { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <Surface className="w-full p-8">
        <h1 className="font-display text-lg font-bold text-ink-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-ink-600">
          The page hit an unexpected error. It&apos;s been logged — try again.
        </p>
        <Button className="mt-6" onClick={() => reset()}>
          Try again
        </Button>
      </Surface>
    </main>
  );
}
