import type { Metadata } from 'next';
import { PageShell } from '@/components/brand/page-shell';
import { Wizard } from '@/components/onboarding/wizard';

export const metadata: Metadata = {
  title: 'Set up your shop',
  robots: { index: false },
};

export default function OnboardingPage() {
  return (
    <PageShell>
      <main className="px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-[#1111111f] py-12 md:py-20 min-h-[60vh]">
        <div className="max-w-2xl">
          <Wizard />
        </div>
      </main>
    </PageShell>
  );
}
