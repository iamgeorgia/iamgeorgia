import type { Metadata } from "next";

import { DRIVER_NAMESPACES, pickClientDictionary } from "@/lib/i18n/client";
import { DictionaryProvider } from "@/lib/i18n/provider";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: {
    default: "Driver panel",
    template: "%s — I am Georgia Drivers",
  },
  robots: { index: false, follow: false },
};

/**
 * The driver panel. The sign-in page sits here, outside the authenticated
 * shell; everything else lives under `(panel)`, which checks the session.
 */
export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();

  return (
    <DictionaryProvider dictionary={pickClientDictionary(t, DRIVER_NAMESPACES)}>
      {children}
    </DictionaryProvider>
  );
}
