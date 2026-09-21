import type { Metadata } from "next";

import { MotionProvider } from "@/components/motion/MotionProvider";

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
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // The panel's dialogs and disclosure panels animate; the engine behind them
  // loads lazily, after the screen is usable.
  return <MotionProvider>{children}</MotionProvider>;
}
