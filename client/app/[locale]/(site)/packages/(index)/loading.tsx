import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { Container } from "@/components/ui/Container";

/**
 * The listing's silhouette while its catalogue read is in flight, so a
 * navigation here paints at once. Lives in the `(index)` group beside the
 * page rather than at `packages/` — a loading boundary above `[slug]` would
 * turn every unknown package into a streamed 200 instead of a 404.
 */
export default function PackagesLoading() {
  return (
    <>
      <Skeleton className="h-[52svh] w-full rounded-none" />
      <Container className="py-16">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-5 h-10 w-2/3 max-w-lg" />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      </Container>
    </>
  );
}
