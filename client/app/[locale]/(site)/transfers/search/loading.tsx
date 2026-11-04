import { Container } from "@/components/ui/Container";
import { Skeleton, TransferCardSkeleton } from "@/components/ui/Skeleton";

export default function TransferSearchLoading() {
  return (
    <Container className="pt-8 pb-24 lg:pb-32">
      <Skeleton className="h-4 w-56" />
      <Skeleton className="mt-6 h-12 w-72" />
      <Skeleton className="mt-6 h-8 w-full max-w-xl" />
      <Skeleton className="mt-8 h-24 w-full" />

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="hidden lg:col-span-3 lg:block">
          <Skeleton className="h-5 w-24" />
          <div className="mt-6 flex flex-col gap-6">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-5 lg:col-span-9">
          {Array.from({ length: 4 }, (_, index) => (
            <TransferCardSkeleton key={index} />
          ))}
        </div>
      </div>
    </Container>
  );
}
