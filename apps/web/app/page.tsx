import { Badge } from '@/components/Badge';
import { FoundationTile } from '@/components/FoundationTile';
import { Wordmark } from '@/components/Wordmark';

const foundationPieces = [
  { name: 'apps/web', detail: 'Next.js app shell — this page. Product surfaces ship in later phases.' },
  { name: 'apps/api', detail: 'NestJS modular monolith with empty Identity, Social, Market, Trading, and Notifications modules.' },
  { name: 'apps/workers', detail: 'Independently deployable process for future blockchain indexing and background jobs.' },
  { name: 'database', detail: 'PostgreSQL + TimescaleDB, with chains, tokens, and token_markets as the first migration.' },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6 py-20">
      <div className="flex flex-col gap-5">
        <Wordmark />
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
          Discover what&apos;s moving. See who&apos;s buying. Trade without leaving the story.
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-ink-600">
          This is the production foundation, not the product. Discovery, social proof, wallets,
          and trading are built in the phases that follow.
        </p>
        <div>
          <Badge>Phase 0 — Foundation</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {foundationPieces.map((piece) => (
          <FoundationTile key={piece.name} name={piece.name} detail={piece.detail} />
        ))}
      </div>
    </main>
  );
}
