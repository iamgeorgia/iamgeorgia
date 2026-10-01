"use client";

import { useState } from "react";

import type { HelpRole } from "@/lib/admin/help/types";
import { HelpSearch } from "./HelpSearch";

/**
 * The hub's search box and the content it stands over. While a query is
 * being answered the browse content steps aside, so results are the only
 * list on screen — the same behaviour as typing into a register's filter.
 */
export function HelpHub({
  role,
  categoryTitles,
  children,
}: {
  role: HelpRole;
  categoryTitles: Record<string, string>;
  children: React.ReactNode;
}) {
  const [searching, setSearching] = useState(false);

  return (
    <div>
      <HelpSearch role={role} categoryTitles={categoryTitles} onActiveChange={setSearching} />
      <div hidden={searching}>{children}</div>
    </div>
  );
}
