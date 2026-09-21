import type { Metadata } from "next";

import { MotionProvider } from "@/components/motion/MotionProvider";
import { PANEL_NAMESPACES, pickClientDictionary } from "@/lib/i18n/client";
import { DictionaryProvider } from "@/lib/i18n/provider";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: {
    default: "Admin",
    template: "%s — I'am Georgia Admin",
  },
  // An internal tool has no business in an index.
  robots: { index: false, follow: false },
};

/**
 * Everything under `/admin` shares this metadata but not its chrome: the panel
 * shell lives one level down in `(panel)/layout.tsx`, so the sign-in screen —
 * which must not show a navigation sidebar to someone who has not signed in —
 * can sit alongside it without the shell having to special-case a route.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();

  // The panel's dialogs and disclosure panels animate; the engine behind them
  // loads lazily, after the screen is usable. The strings are the shared
  // booking and order components' share only — the panel itself is English.
  return (
    <DictionaryProvider dictionary={pickClientDictionary(t, PANEL_NAMESPACES)}>
      <MotionProvider>{children}</MotionProvider>
    </DictionaryProvider>
  );
}
