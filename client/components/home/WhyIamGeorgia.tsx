import { Reveal, RevealGroup, RevealItem } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import { getI18n } from "@/lib/i18n/server";


/** Typography-led and restrained — the counterweight to the image sections. */
export async function WhyIamGeorgia() {
  const { t } = await getI18n();
  const reasons = t.home.why.reasons;
  return (
    <section className="py-16 sm:py-24 lg:py-32">
      <Container>
        <div className="grid grid-cols-1 gap-14 lg:grid-cols-12 lg:gap-16">
          {/* The intro pins while the numbered list scrolls past it. `self-start`
              is what makes this work: a stretched grid item is already the full
              row height, so `sticky` would have nothing left to travel through.
              Offset clears the fixed header (h-18 / lg:h-20) plus breathing room.
              The sticky box and the reveal are kept as separate elements so the
              entrance transform never sits on the element being positioned. */}
          <div className="lg:col-span-5 lg:sticky lg:top-32 lg:self-start">
            <Reveal>
              <p className="type-eyebrow text-brand-text">{t.home.why.eyebrow}</p>
              <h2 className="type-h2 mt-6 text-balance">{t.home.why.title}</h2>
              <p className="type-body-lg mt-6 text-body">{t.home.why.body}</p>
            </Reveal>
          </div>

          <RevealGroup className="lg:col-span-7">
            <ol className="divide-y divide-line border-t border-line">
              {reasons.map((reason, index) => (
                <RevealItem key={reason.title}>
                  <li className="flex gap-6 py-7 lg:gap-10">
                    <span className="type-caption pt-1 text-subtle tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3 className="type-h4">{reason.title}</h3>
                      <p className="type-body mt-2.5 max-w-xl text-muted">{reason.description}</p>
                    </div>
                  </li>
                </RevealItem>
              ))}
            </ol>
          </RevealGroup>
        </div>
      </Container>
    </section>
  );
}
