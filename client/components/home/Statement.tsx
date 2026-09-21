import { Container } from "@/components/ui/Container";
import { getI18n } from "@/lib/i18n/server";

/**
 * Deliberately quiet section after the hero — typography only, no imagery.
 * The page needs somewhere to breathe before the next photograph. Not wrapped
 * in a reveal: on a tall screen its top is visible with the hero, and the
 * first thing a visitor reads should not fade in.
 */
export async function Statement() {
  const { t } = await getI18n();

  return (
    <section className="py-16 sm:py-24 lg:py-36">
      <Container>
        <div className="max-w-4xl">
          <p className="type-eyebrow text-brand-text">{t.home.statement.eyebrow}</p>
          <p className="type-h1 mt-8 text-balance">{t.home.statement.title}</p>
          <p className="type-body-lg mt-8 max-w-2xl text-body">{t.home.statement.body}</p>
        </div>
      </Container>
    </section>
  );
}
