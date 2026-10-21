import type { Metadata } from "next";

import { AccessDenied } from "@/components/admin/AccessDenied";
import { requireAdminSession } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Not available to your role" };

/**
 * Where `requireScreen()` sends a viewer whose role does not open a screen.
 * The refused path and the capabilities it needed arrive in the query; this
 * page only reads them back. It deliberately does not call `requireScreen`
 * itself — a denied page that could deny would loop.
 */
export default async function AdminDeniedPage({ searchParams }: PageProps<"/[locale]/admin/denied">) {
  await requireAdminSession();
  const [{ path }, params] = await Promise.all([getI18n(), searchParams]);

  const refused = typeof params.for === "string" && params.for.startsWith("/admin") ? params.for : null;
  const needs = params.needs === undefined ? [] : Array.isArray(params.needs) ? params.needs : [params.needs];

  return <AccessDenied path={refused} required={needs} needs={path} />;
}
