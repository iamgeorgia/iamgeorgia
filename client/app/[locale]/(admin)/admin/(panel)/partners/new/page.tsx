import type { Metadata } from "next";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminPageHeader,
} from "@/components/admin/AdminPage";
import { PartnerRegistrationForm } from "@/components/admin/PartnerRegistrationForm";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Register a partner" };

export default async function AdminPartnerRegistrationPage() {
  await requireScreen();
  const { path } = await getI18n();

  return (
    <AdminContainer className="max-w-4xl">
      <AdminBreadcrumbs
        items={[
          { label: "Partners", href: path("/admin/partners") },
          { label: "Register a partner" },
        ]}
      />

      <AdminPageHeader
        title="Register a partner"
        description="Add a supplier to the register. They enter the review queue until the paperwork is complete."
      />

      <div className="mt-8">
        <PartnerRegistrationForm />
      </div>
    </AdminContainer>
  );
}
