import type { Metadata } from 'next';
import Link from 'next/link';
import { SignIn } from '@/components/auth/sign-in';
import { Eyebrow, PageShell } from '@/components/brand/page-shell';
import { safeNext } from '@/lib/onboarding';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Selly, or create your shop, with a Nostr key. No password.',
  robots: { index: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const target = safeNext(Array.isArray(next) ? next[0] : next);

  return (
    <PageShell>
      <main className="px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-[#1111111f] py-16 md:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-8 items-start">
          <div className="lg:col-span-5">
            <Eyebrow>Sign in</Eyebrow>
            <h1 className="pv-serif text-5xl md:text-7xl font-light leading-[1.05] mb-8">
              Open your <span className="italic text-[#8AAE4A]">shop</span>
            </h1>
            <p className="pv-sans text-sm leading-relaxed text-black/70 max-w-sm">
              Selly signs you in with a Nostr key instead of a password. Nothing to remember by
              email, nothing to leak. The same step creates your shop the first time.
            </p>
            <p className="pv-sans text-xs leading-relaxed text-black/50 max-w-sm mt-6">
              New to Nostr? Choose “Create a new key”. We make it in your browser and ask you to
              save a backup.
            </p>
          </div>

          <div className="hidden lg:flex lg:col-span-1 justify-center self-stretch">
            <div className="w-px bg-[#1111111f]" />
          </div>

          <div className="lg:col-span-6 max-w-lg w-full">
            <SignIn next={target} />
            <p className="pv-sans text-xs text-black/50 mt-10">
              Want to compare plans first?{' '}
              <Link href="/tarifs" className="underline underline-offset-4 hover:text-[#173B32]">
                See pricing
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
    </PageShell>
  );
}
