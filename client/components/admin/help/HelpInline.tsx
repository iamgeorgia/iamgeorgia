import { Fragment } from "react";

/**
 * The two inline forms help text may carry: `**bold**` for the label of a
 * control as it reads on screen, and `` `code` `` for a status value, a URL
 * or a reference. Anything else is rendered as the characters it is — no
 * HTML, no links, no third form — so an article can never inject markup and
 * the tokeniser stays small enough to read in one sitting.
 */
const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`)/g;

export function HelpInline({ text }: { text: string }) {
  const parts = text.split(TOKEN);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return (
            <strong key={index} className="font-semibold text-ink">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return (
            <code
              key={index}
              className="rounded-xs bg-surface-soft px-1 py-0.5 font-mono text-[0.8125em] text-ink"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}
