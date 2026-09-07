import { MarketHeader } from '@/components/market/MarketHeader';
import { NotificationsPageClient } from '@/components/notifications/NotificationsPageClient';

export const metadata = { title: 'Notifications — Fomo' };

/**
 * Entirely client-rendered below the header, same reasoning as app/trades/page.tsx:
 * notifications are personal to whatever session this browser has, which a Server
 * Component structurally cannot see. See docs/NOTIFICATIONS.md.
 */
export default function NotificationsPage() {
  return (
    <>
      <MarketHeader />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="font-display text-xl font-bold text-ink-900">Notifications</h1>
        <p className="mt-1 font-body text-sm text-ink-600">Follows, likes, and trade alerts from people and tokens you care about.</p>
        <div className="mt-6">
          <NotificationsPageClient />
        </div>
      </main>
    </>
  );
}
