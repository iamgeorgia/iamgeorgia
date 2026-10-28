import { Eye } from "lucide-react";

import { capabilityLabel } from "@/lib/admin/capabilities";
import { cn } from "@/lib/utils";

/**
 * The one line a read-only viewer sees where an editor's controls would be.
 *
 * Names the capability that would unlock the screen, in the words the Roles
 * editor uses, so the sentence is something the viewer can act on — ask for
 * *Catalogue: edit*, not "access". Shown in place of a Save button or an
 * action row, never beside disabled controls that look broken.
 */
export function ReadOnlyNote({
  needs,
  what = "Changing this",
  className,
}: {
  /** The capabilities any one of which would allow the change. */
  needs: string | string[];
  /** What the viewer cannot do here: "Cancelling a booking", "Editing rates". */
  what?: string;
  className?: string;
}) {
  const labels = (Array.isArray(needs) ? needs : [needs]).map(capabilityLabel);

  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-sm border border-dashed border-line bg-surface-soft/60 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-muted",
        className,
      )}
    >
      <Eye size={14} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
      <span>
        You are viewing this read-only. {what} needs{" "}
        {labels.length === 1 ? (
          <strong className="font-medium text-ink">{labels[0]}</strong>
        ) : (
          <>
            one of{" "}
            {labels.map((label, index) => (
              <span key={label}>
                <strong className="font-medium text-ink">{label}</strong>
                {index < labels.length - 1 ? ", " : ""}
              </span>
            ))}
          </>
        )}
        .
      </span>
    </p>
  );
}
