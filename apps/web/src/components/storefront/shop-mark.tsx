/** The shop's mark: its logo, or a sharp square with its initial, and its name in the serif. */
export function ShopMark({
  name,
  logo,
  light = false,
}: {
  name: string;
  logo: string | null;
  light?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      {logo ? (
        // The vendor's logo: one size from the API, no width/height to give.
        <img src={logo} alt="" className="size-11 shrink-0 object-cover" />
      ) : (
        <span
          aria-hidden="true"
          className={`sf-serif grid size-11 shrink-0 place-items-center text-2xl font-semibold ${light ? 'bg-d-paper text-[var(--sf-ink)]' : 'bg-[var(--sf-ink)] text-d-paper'}`}
        >
          {name.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <span className="sf-serif truncate text-[1.375rem] leading-none font-semibold min-[400px]:text-[1.625rem]">
        {name}
      </span>
    </span>
  );
}
