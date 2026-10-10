"use client";

import { useRouter } from "next/navigation";
import { Check, Undo2, X } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "../AdminPage";
import { FormError, SubmitButton, TextArea } from "../FormControls";
import { Modal } from "@/components/ui/Modal";
import { approveApproval, cancelApproval, rejectApproval } from "@/lib/api/approvals";
import { describeError } from "@/lib/api/client";
import type { Approval } from "@/types/approval";

type Dialog = "approve" | "reject" | "withdraw" | null;

const secondary =
  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink";

/**
 * Decide on a request, or take your own back. The page decides who sees which:
 * Approve and Reject only for someone who holds the approving capability and
 * did not ask for it (the server refuses self-approval regardless), Withdraw
 * only for the person who asked. Each opens a confirm step, because deciding
 * is not undone.
 */
export function ApprovalDecision({
  approval,
  canDecide,
  isRequester,
}: {
  approval: Approval;
  canDecide: boolean;
  isRequester: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (approval.status !== "PENDING") return null;
  if (!canDecide && !isRequester) return null;

  const close = () => {
    if (busy) return;
    setDialog(null);
    setNote("");
    setError(null);
  };

  const run = async () => {
    if (!dialog) return;
    setBusy(true);
    setError(null);

    try {
      if (dialog === "approve") await approveApproval(approval.id, note.trim());
      else if (dialog === "reject") await rejectApproval(approval.id, note.trim());
      else await cancelApproval(approval.id);

      setDialog(null);
      setNote("");
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
      // A request someone else already decided is stale on screen; show the real state.
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const copy = {
    approve: {
      title: "Approve this request",
      text: "The change is made as soon as you confirm, in the name of the person who asked. Check the details first.",
      button: "Approve",
      label: "Note (optional)",
    },
    reject: {
      title: "Reject this request",
      text: "Nothing changes. The person who asked is told, and can ask again.",
      button: "Reject",
      label: "Why not? (optional)",
    },
    withdraw: {
      title: "Withdraw this request",
      text: "Nobody will be asked to decide on it. You can ask again later.",
      button: "Withdraw",
      label: "",
    },
  };

  const current = dialog ? copy[dialog] : null;

  return (
    <AdminPanel title="Decision">
      <div className="space-y-2.5">
        {canDecide && !isRequester && (
          <>
            <button
              type="button"
              onClick={() => setDialog("approve")}
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              <Check size={15} aria-hidden />
              Approve
            </button>
            <button type="button" onClick={() => setDialog("reject")} className={secondary}>
              <X size={15} aria-hidden />
              Reject
            </button>
          </>
        )}

        {isRequester && (
          <button type="button" onClick={() => setDialog("withdraw")} className={secondary}>
            <Undo2 size={15} aria-hidden />
            Withdraw my request
          </button>
        )}
      </div>

      {isRequester && canDecide && (
        <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted">
          You asked for this, so someone else has to decide on it.
        </p>
      )}

      <Modal open={dialog !== null} onClose={close} title={current?.title ?? ""} size="sm">
        {current && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
            className="px-6 pt-4 pb-6"
          >
            <p className="text-[0.8125rem] leading-relaxed text-muted">{current.text}</p>

            {dialog !== "withdraw" && (
              <TextArea
                className="mt-5"
                label={current.label}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={500}
              />
            )}

            <FormError message={error} />

            <div className="mt-6 flex flex-wrap gap-2">
              <SubmitButton type="submit" busy={busy}>
                {current.button}
              </SubmitButton>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>
    </AdminPanel>
  );
}
