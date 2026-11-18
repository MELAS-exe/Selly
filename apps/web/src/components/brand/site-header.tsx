/**
 * The header used on every public page (landing, pricing, sign-in, onboarding): logo, an explicit
 * Home link, Pricing, Sign in and the "Create your shop" call to action. Kept in one place so the
 * links and styling never drift between pages.
 *
 * `onDark` switches to the light wordmark and a dark translucent bar, for the landing page's header
 * while it overlaps a dark section. Pages without dark sections never pass it.
 */
export function SiteHeader({
  onDark = false,
  sticky = false,
}: {
  onDark?: boolean;
  sticky?: boolean;
}) {
  return (
    <header
      data-dark={onDark}
      className={`${sticky ? 'sticky' : 'fixed'} top-0 left-0 right-0 z-50 transition-colors duration-(--dur-ui) py-5 backdrop-blur-xl backdrop-saturate-150 border-b ${onDark ? 'bg-[#111]/45 border-white/10' : 'bg-[#F6F4F0]/55 border-[#1111111f]'}`}
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12 flex justify-between items-center gap-6">
        <div className="flex items-center gap-6">
          <a
            href="/"
            aria-label="Selly, home"
            className="pv-serif text-2xl font-bold tracking-widest uppercase flex items-center"
          >
            <span className="relative block">
              <img
                src="/brand/selly-wordmark.png"
                alt="Selly"
                className={`h-7 md:h-8 w-auto transition-opacity duration-(--dur-ui) ${onDark ? 'opacity-0' : 'opacity-100'}`}
              />
              <img
                src="/brand/selly-wordmark-light.png"
                alt=""
                aria-hidden="true"
                className={`absolute inset-0 h-7 md:h-8 w-auto transition-opacity duration-(--dur-ui) ${onDark ? 'opacity-100' : 'opacity-0'}`}
              />
            </span>
          </a>
          <a
            href="/"
            className="pv-sans text-xs uppercase tracking-widest font-medium hover:text-[#719541] transition-colors"
          >
            Home
          </a>
        </div>
        <nav aria-label="Main" className="hidden md:flex items-center gap-6 md:gap-8">
          <a
            href="/tarifs"
            className="pv-sans text-xs uppercase tracking-widest font-medium hover:text-[#719541] transition-colors"
          >
            Pricing
          </a>
          <a
            href="/app/login"
            className="pv-sans text-xs uppercase tracking-widest font-medium hover:text-[#719541] transition-colors"
          >
            Sign in
          </a>
          <a
            href="/app/login"
            className="pv-sans text-xs uppercase tracking-widest font-medium hover:text-[#719541] transition-colors"
          >
            Create your shop{' '}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-arrow-right inline ml-1"
              aria-hidden="true"
            >
              <path d="M5 12h14"></path>
              <path d="m12 5 7 7-7 7"></path>
            </svg>
          </a>
        </nav>
        <a
          href="/app/login"
          className="md:hidden pv-sans text-xs uppercase tracking-widest font-medium hover:text-[#719541] transition-colors"
        >
          Create your shop
        </a>
      </div>
    </header>
  );
}
