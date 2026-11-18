import Link from 'next/link';
import type { CategorySummary } from '@/lib/types';

/**
 * The vendor's own categories as a horizontal filter, plus "Tout" to clear it. A plain link list:
 * it works without JavaScript, and `?category=` is read on the server (app/s/[slug]/page.tsx).
 */
export function CategoryNav({
  slug,
  categories,
  active,
}: {
  slug: string;
  categories: CategorySummary[];
  active?: string;
}) {
  if (categories.length === 0) return null;
  const chip = (href: string, label: string, isActive: boolean) => (
    <Link
      key={href}
      href={href}
      aria-current={isActive ? 'true' : undefined}
      className={`chip min-h-9 shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium whitespace-nowrap ${
        isActive ? 'border-indigo bg-indigo text-paper' : 'border-line text-ink'
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav
      aria-label="Catégories"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
    >
      {chip(`/s/${slug}`, 'Tout', !active)}
      {categories.map((c) => chip(`/s/${slug}?category=${c.slug}`, c.name, active === c.slug))}
    </nav>
  );
}
