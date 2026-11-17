export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">Commande {token}</h1>
      <p className="mt-2 text-neutral-600">
        TODO (Dev 1): paiement Lightning (QR, lien lightning:, SSE) et suivi de commande.
      </p>
    </main>
  );
}
