import type { Metadata } from "next";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { RatingsQueue } from "@/components/admin/RatingsQueue";
import { listRatings } from "@/lib/api/ratings";
import type { RatingStatus } from "@/types/driver";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Driver ratings" };

const STATUSES: RatingStatus[] = ["PENDING", "PUBLISHED", "REJECTED"];
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function AdminRatingsPage({
  searchParams,
}: PageProps<"/[locale]/admin/transfers/ratings">) {
  await requireScreen();
  const params = await searchParams;
  const requested = first(params.status);
  const status = STATUSES.includes(requested as RatingStatus) ? (requested as RatingStatus) : "PENDING";
  const page = Math.max(1, Number.parseInt(first(params.page) ?? "1", 10) || 1);

  const result = await listRatings({ status, page, pageSize: 25 });

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Driver ratings"
        description="Scores go straight to the driver's average. Words wait here for a look first."
      />
      <div className="mt-8">
        <RatingsQueue {...result} status={status} />
      </div>
    </AdminContainer>
  );
}
