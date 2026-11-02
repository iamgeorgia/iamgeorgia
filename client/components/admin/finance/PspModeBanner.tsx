import { FlaskConical } from "lucide-react";

import { getPaymentsSettings } from "@/lib/api/payments";
import type { PaymentsSettings } from "@/types/payments";

/**
 * The amber bar shown on every panel page while card payments run against the
 * gateway's test merchant, so nobody mistakes a test payment for money.
 *
 * Renders nothing in live mode, and nothing when the settings cannot be read
 * (a 403 for a role that never sees payments, a 404 from an older server, the
 * API being down): a missing banner is better than a broken layout.
 */
export async function PspModeBanner() {
  let settings: PaymentsSettings | null = null;

  try {
    settings = await getPaymentsSettings();
  } catch {
    return null;
  }

  if (!settings?.enabled || settings.mode !== "TEST") return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-warning/40 bg-warning/15 px-4 py-2 text-[0.8125rem] text-warning-text sm:px-6"
    >
      <FlaskConical size={15} className="shrink-0" aria-hidden />
      <p>
        Card payments run in Flitt TEST mode (merchant {settings.merchantId ?? "unknown"}). No real money moves.
      </p>
    </div>
  );
}
