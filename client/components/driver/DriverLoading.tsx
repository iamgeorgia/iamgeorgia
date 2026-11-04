/**
 * What a tab shows while its page is read. The title is the real one, so the
 * tap is acknowledged in words at once; the cards below are placeholders in
 * the shape of the cards that will replace them.
 */
export function DriverLoading({ title, variant = "list" }: { title: string; variant?: "list" | "today" | "profile" }) {
  const bar = "animate-pulse rounded-sm bg-surface-soft";

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-[1.5rem] leading-[1.25] font-semibold tracking-[-0.01em] text-ink sm:text-[1.75rem]">{title}</h1>
        <div className={`${bar} mt-2.5 h-4 w-40`} />
      </header>
      <p role="status" className="sr-only">
        Loading {title.toLowerCase()}…
      </p>

      {variant === "profile" ? (
        <div className="space-y-4 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-8 lg:space-y-0">
          <div className="h-64 rounded-md border border-line bg-surface" aria-hidden />
          <div className="h-96 rounded-md border border-line bg-surface" aria-hidden />
        </div>
      ) : (
        <>
          {/* Today opens on the Up next panel: hold its place, so the page does
            not jump when it arrives. */}
          {variant === "today" && <div className="mb-8 h-60 animate-pulse rounded-md bg-ink/90" aria-hidden />}
          <ul className="space-y-3" aria-hidden>
            {[0, 1, 2].map((index) => (
              <li key={index} className="flex gap-4 rounded-md border border-line bg-surface p-4 sm:p-5">
                <div className={`${bar} h-6 w-14 shrink-0`} />
                <div className="flex-1 space-y-2.5">
                  <div className={`${bar} h-4 w-3/4`} />
                  <div className={`${bar} h-3.5 w-1/2`} />
                  <div className={`${bar} h-6 w-28 rounded-full`} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
