'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '@/lib/wagmi-config';

/**
 * wagmi requires a TanStack Query client for its internal caching — this app otherwise has
 * no React Query usage (see docs/SOCIAL.md's hand-rolled useState/useTransition pattern),
 * so this QueryClient exists solely to satisfy that requirement, not as a general data
 * layer. One instance per browser session, created lazily so it survives Fast Refresh in
 * development without being recreated on every render.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
