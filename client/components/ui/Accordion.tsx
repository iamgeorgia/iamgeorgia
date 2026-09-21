"use client";

import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/lib/utils";

export interface AccordionItem {
  id: string;
  title: string;
  /** Optional line beside the title, e.g. a day number or a price. */
  meta?: string;
  content: React.ReactNode;
}

interface AccordionProps {
  items: AccordionItem[];
  /** Index left open on first render. Use -1 for all closed. */
  defaultOpen?: number;
  className?: string;
}

export function Accordion({ items, defaultOpen = 0, className }: AccordionProps) {
  const [openId, setOpenId] = useState<string | null>(items[defaultOpen]?.id ?? null);
  const baseId = useId();
  const reduceMotion = useReducedMotion();

  return (
    <div className={cn("divide-y divide-line border-y border-line", className)}>
      {items.map((item) => {
        const isOpen = openId === item.id;
        const panelId = `${baseId}-${item.id}-panel`;
        const buttonId = `${baseId}-${item.id}-button`;

        return (
          <div key={item.id}>
            <h3>
              <button
                id={buttonId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenId(isOpen ? null : item.id)}
                className="flex w-full items-start justify-between gap-6 py-5 text-start transition-colors hover:text-brand-text"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-5">
                  {item.meta && (
                    <span className="type-caption shrink-0 text-muted tabular-nums sm:w-16">
                      {item.meta}
                    </span>
                  )}
                  <span className="type-h4">{item.title}</span>
                </span>
                <Plus
                  size={18}
                  className={cn(
                    "mt-0.5 shrink-0 text-muted transition-transform duration-300 ease-(--ease-out-soft)",
                    isOpen && "rotate-45",
                  )}
                  aria-hidden
                />
              </button>
            </h3>

            <AnimatePresence initial={false}>
              {isOpen && (
                <m.div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  animate={reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <div className="pb-7 sm:ps-21">{item.content}</div>
                </m.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
