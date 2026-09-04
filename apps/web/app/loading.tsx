export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div
        aria-label="Loading"
        role="status"
        className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent"
      />
    </main>
  );
}
