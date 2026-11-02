import { Check } from "lucide-react";

import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

type Step = "choose" | "details" | "pay" | "confirm";
type LabelledStep = Exclude<Step, "pay">;

const ORDER: Step[] = ["choose", "details", "pay", "confirm"];

interface BookingStepsProps {
  current: Step;
  /** The wording, when the product is not a hotel stay — a tour names its steps differently. */
  labels?: Record<LabelledStep, string>;
}

/**
 * Where the traveller is in the booking.
 *
 * Four steps because there are four: pick a room, say who you are, pay (or
 * choose to pay later), and it is done. It is an `<ol>` with the current step marked `aria-current` rather than
 * a row of decorated divs — a progress indicator that a screen reader cannot
 * read is decoration, and this one is carrying real orientation.
 */
export async function BookingSteps({ current, labels }: BookingStepsProps) {
  const { t } = await getI18n();
  const words: Record<Step, string> = { ...(labels ?? t.booking.checkout.steps), pay: t.payment.stepLabel };
  const currentIndex = ORDER.indexOf(current);

  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {ORDER.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;

        return (
          <li key={step} className="flex items-center gap-3">
            <span
              className={cn(
                "flex items-center gap-2 text-[0.8125rem]",
                active ? "font-medium text-ink" : done ? "text-body" : "text-subtle",
              )}
              aria-current={active ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold tabular-nums",
                  active
                    ? "bg-brand text-on-dark"
                    : done
                      ? "bg-success text-on-dark"
                      : "border border-line text-subtle",
                )}
              >
                {done ? <Check size={12} aria-hidden /> : index + 1}
              </span>
              {words[step]}
            </span>

            {index < ORDER.length - 1 && (
              <span className="h-px w-6 bg-line sm:w-10" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
