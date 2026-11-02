import { Container } from "@/components/ui/Container";
import { HotelCardSkeleton, Skeleton } from "@/components/ui/Skeleton";

export default function HotelsLoading() {
  return (
    <>
      <Skeleton className="h-[52svh] w-full rounded-none" />
      <Container className="py-16">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="hidden lg:col-span-3 lg:block">
            <Skeleton className="h-5 w-24" />
            <div className="mt-6 flex flex-col gap-6">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-24 w-full" />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-5 lg:col-span-9">
            {Array.from({ length: 4 }, (_, index) => (
              <HotelCardSkeleton key={index} />
            ))}
          </div>
        </div>
      </Container>
    </>
  );
}
