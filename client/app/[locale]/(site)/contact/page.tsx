import type { Metadata } from "next";
import Image from "next/image";
import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";

import { ContactForm } from "@/components/contact/ContactForm";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import { site } from "@/constants/site";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();

  return pageMetadata({
    path: "/contact",
    title: t.contact.metaTitle,
    description: t.contact.metaDescription,
  });
}

export default function ContactPage() {
  const details = [
    { icon: Mail, label: "Email", value: site.contact.email, href: `mailto:${site.contact.email}` },
    {
      icon: Phone,
      label: "Telephone",
      value: site.contact.phone,
      href: `tel:${site.contact.phone.replace(/\s/g, "")}`,
    },
    {
      icon: MessageCircle,
      label: "WhatsApp",
      value: site.contact.whatsapp,
      href: `https://wa.me/${site.contact.whatsapp.replace(/[^\d]/g, "")}`,
    },
    { icon: MapPin, label: "Studio", value: site.contact.address },
    { icon: Clock, label: "Opening hours", value: site.contact.hours },
  ];

  return (
    <>
      <section className="border-b border-line py-16 lg:py-20">
        <Container>
          <div className="max-w-3xl">
            <p className="type-eyebrow text-brand-text">Plan your trip</p>
            <h1 className="type-h1 mt-5 text-balance">
              Tell us what kind of traveller you are
            </h1>
            <p className="type-body-lg mt-6 max-w-xl text-body">
              Every journey starts with a few questions and no obligation. We reply within one
              working day, in English, Georgian, Russian or German.
            </p>
          </div>
        </Container>
      </section>

      <section className="py-16 lg:py-20">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <Reveal>
                <h2 className="type-h3">Get in touch directly</h2>
                <dl className="mt-8 space-y-6">
                  {details.map((detail) => (
                    <div key={detail.label} className="flex gap-4">
                      <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-sm bg-surface-soft text-brand-text">
                        <detail.icon size={17} aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <dt className="type-caption text-muted">{detail.label}</dt>
                        <dd className="type-body-sm mt-1 text-ink">
                          {detail.href ? (
                            <a
                              href={detail.href}
                              className="underline-offset-4 transition-colors hover:text-brand-text hover:underline"
                              {...(detail.href.startsWith("http")
                                ? { target: "_blank", rel: "noreferrer noopener" }
                                : {})}
                            >
                              {detail.value}
                            </a>
                          ) : (
                            detail.value
                          )}
                        </dd>
                      </div>
                    </div>
                  ))}
                </dl>

                <div className="mt-10 border-t border-line pt-8">
                  <h3 className="type-caption text-muted">Follow</h3>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {site.social.map((item) => (
                      <li key={item.label}>
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex h-9 items-center rounded-full border border-line px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink hover:text-ink"
                        >
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="relative mt-10 aspect-16/10 overflow-hidden rounded-sm">
                  <Image
                    src="/images/culture/balconies.jpg"
                    alt="The tiled Orbeliani bathhouse facade in old Tbilisi, near our studio"
                    fill
                    sizes="(max-width: 1024px) 90vw, 40vw"
                    className="object-cover"
                  />
                </div>
              </Reveal>
            </div>

            {/* The form is the page's purpose and, on desktop, its first
                screen — it is never faded in. */}
            <div className="lg:col-span-7">
              <ContactForm />
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
