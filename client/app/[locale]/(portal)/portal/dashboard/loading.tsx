import { Container } from "@/components/ui/Container";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * The dashboard's shape while its three reads are in flight. A leaf route
 * with no dynamic children, so a boundary here cannot turn a 404 into a 200.
 */
export default function PortalDashboardLoading() {
  return (
    <Container className="py-12 sm:py-16">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-10 w-2/3 max-w-md" />
      <Skeleton className="mt-5 h-4 w-56" />

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="rounded-sm border border-line bg-surface p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-16" />
          </div>
        ))}
      </div>

      <section className="mt-12">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="mt-5 h-40 w-full" />
      </section>
    </Container>
  );
}
