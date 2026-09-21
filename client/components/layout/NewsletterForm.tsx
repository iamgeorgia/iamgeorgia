"use client";

import { AnimatePresence, m } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/lib/i18n/provider";

/**
 * Front-end only. Nothing is sent or stored — submitting swaps to a local
 * confirmation state to show what the interaction would feel like.
 */
export function NewsletterForm() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "error" | "done">("idle");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus("error");
      return;
    }
    setStatus("done");
  };

  return (
    <div className="mt-6">
      <AnimatePresence mode="wait" initial={false}>
        {status === "done" ? (
          <m.p
            key="done"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 py-3 text-sm text-on-dark"
          >
            <Check size={16} className="text-accent-gold-on-dark" aria-hidden />
            {t.footer.newsletterThanks}
          </m.p>
        ) : (
          <m.form
            key="form"
            initial={false}
            exit={{ opacity: 0 }}
            onSubmit={handleSubmit}
            noValidate
            className="flex items-center gap-0 border-b border-on-dark/25 focus-within:border-on-dark"
          >
            <label htmlFor="footer-email" className="sr-only">
              Email address
            </label>
            <input
              id="footer-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (status === "error") setStatus("idle");
              }}
              placeholder={t.footer.emailPlaceholder}
              aria-invalid={status === "error"}
              aria-describedby={status === "error" ? "footer-email-error" : undefined}
              className="min-w-0 flex-1 bg-transparent py-3 text-sm text-on-dark placeholder:text-on-dark/35 focus:outline-none"
            />
            <button
              type="submit"
              aria-label={t.actions.subscribe}
              className="flex size-9 shrink-0 items-center justify-center text-on-dark/60 transition-colors hover:text-on-dark"
            >
              <ArrowRight size={17} className="rtl:-scale-x-100" aria-hidden />
            </button>
          </m.form>
        )}
      </AnimatePresence>

      {status === "error" && (
        <p id="footer-email-error" role="alert" className="type-caption mt-2 text-error-on-dark">
          {t.footer.newsletterError}
        </p>
      )}
    </div>
  );
}
