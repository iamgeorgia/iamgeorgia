import { redirect } from "next/navigation";

import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

/**
 * There is no Transfers landing screen, on purpose.
 *
 * The four catalogue screens under this path are unrelated jobs, and the
 * sidebar already lists them all under a Transfers section — a hub here would
 * be a page whose only content is a copy of that list. This exists to catch a
 * hand-typed or bookmarked `/admin/transfers` and put it to work.
 */
export default async function AdminTransfersIndex() {
  await requireScreen();
  const { path } = await getI18n();

  redirect(path("/admin/transfers/routes"));
}
