"use client";

import { useState } from "react";

import { HelpSearch } from "./HelpSearch";

/**
 * The hub's search box and the content it stands over. While a query is
 * being answered the browse content steps aside, so results are the only
 * list on screen — the same behaviour as typing into a register's filter.
 */
export function HelpHub({
  capabilities,
  categoryTitles,
  children,
}: {
  /** What the reader holds; the search indexes only the articles these open. */
  capabilities: readonly string[];
  categoryTitles: Record<string, string>;
  children: React.ReactNode;
}) {
  const [searching, setSearching] = useState(false);

  return (
    <div>
      <HelpSearch capabilities={capabilities} categoryTitles={categoryTitles} onActiveChange={setSearching} />
      <div hidden={searching}>{children}</div>
    </div>
  );
}
