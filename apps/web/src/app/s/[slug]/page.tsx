export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">Boutique {slug}</h1>
      <p className="mt-2 text-neutral-600">
        TODO (Dev 1): vitrine, panier et widget de chat (architecture.md 3.4 et 3.8).
      </p>
    </main>
  );
}
