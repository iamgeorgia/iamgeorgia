import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";

import { Logo } from "./Logo";
import { NewsletterForm } from "./NewsletterForm";
import { Container } from "@/components/ui/Container";
import { site } from "@/constants/site";
import { getI18n } from "@/lib/i18n/server";
import { footerNavigation } from "@/lib/navigation";

/** Half the row on a phone (less half the 2.5rem gap); ignored once the block is a grid. */
const linkGroup = "grow basis-[calc(50%-1.25rem)]";

export async function Footer() {
  const { t, path, fill } = await getI18n();

  return (
    <footer className="mt-auto bg-ink text-on-dark">
      <Container className="py-20 lg:py-24">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-4">
            <p className="flex items-center gap-3 font-display text-2xl tracking-[0.06em]">
              <Logo className="size-10" />
              {site.wordmark}
            </p>
            <p className="type-body mt-6 max-w-sm text-on-dark/60">{t.meta.description}</p>

            <ul className="mt-10 space-y-3.5">
              <li className="flex items-start gap-3 text-on-dark/70">
                <MapPin size={16} className="mt-1 shrink-0 text-on-dark/40" aria-hidden />
                <span className="type-body-sm">{site.contact.address}</span>
              </li>
              <li className="flex items-start gap-3">
                <Mail size={16} className="mt-1 shrink-0 text-on-dark/40" aria-hidden />
                <a
                  href={`mailto:${site.contact.email}`}
                  className="type-body-sm text-on-dark/70 underline-offset-4 transition-colors hover:text-on-dark hover:underline"
                >
                  {site.contact.email}
                </a>
              </li>
              <li className="flex items-start gap-3">
                <Phone size={16} className="mt-1 shrink-0 text-on-dark/40" aria-hidden />
                <a
                  href={`tel:${site.contact.phone.replace(/\s/g, "")}`}
                  className="type-body-sm text-on-dark/70 underline-offset-4 transition-colors hover:text-on-dark hover:underline"
                >
                  {site.contact.phone}
                </a>
              </li>
            </ul>
          </div>

          {/* Three link columns need more than a third of the row: squeezed into
              four twelfths at 1024px they were ~67px each and "Управление
              бронированием" ran into its neighbour. Two columns in the `lg`
              band, three again from `xl`.

              No column may be narrower than its longest word: the Georgian
              "კონფიდენციალურობის" is 185px and was cut in half by every equal
              share on offer. So the grid tracks keep a min-content floor (the
              plain `grid-cols-*` utilities are `minmax(0, 1fr)` and shrink
              past it), and on a phone each group is half the row unless its
              longest word needs more, in which case it takes a row of its own.
              Where everything fits — English, at every width — the columns
              come out exactly equal, as before. */}
          <div className="flex flex-wrap gap-10 sm:grid sm:grid-cols-[repeat(3,minmax(min-content,1fr))] lg:col-span-5 lg:grid-cols-[repeat(2,minmax(min-content,1fr))] lg:gap-x-6 xl:grid-cols-[repeat(3,minmax(min-content,1fr))]">
            {footerNavigation(t).map((group) => (
              <div key={group.title} className={linkGroup}>
                <h2 className="type-eyebrow text-on-dark/40">{group.title}</h2>
                <ul className="mt-5 space-y-3">
                  {group.items.map((item) => (
                    <li key={`${group.title}-${item.label}`}>
                      <Link
                        href={path(item.href)}
                        className="type-body-sm text-on-dark/70 transition-colors hover:text-on-dark"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className={linkGroup}>
              <h2 className="type-eyebrow text-on-dark/40">{t.nav.groups.follow}</h2>
              <ul className="mt-5 space-y-3">
                {site.social.map((item) => (
                  <li key={item.label}>
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="type-body-sm text-on-dark/70 transition-colors hover:text-on-dark"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Newsletter is visual only — nothing is submitted or stored. */}
          <div className="lg:col-span-3">
            <h2 className="type-eyebrow text-on-dark/40">{t.footer.dispatches}</h2>
            <p className="type-body-sm mt-5 text-on-dark/60">{t.footer.newsletterBody}</p>
            <NewsletterForm />
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-4 border-t border-on-dark/12 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="type-caption text-on-dark/40">
            {fill(t.footer.rights, { year: new Date().getFullYear(), name: site.name })}
          </p>
          <p className="type-caption text-on-dark/40">{site.contact.hours}</p>
        </div>
      </Container>
    </footer>
  );
}
