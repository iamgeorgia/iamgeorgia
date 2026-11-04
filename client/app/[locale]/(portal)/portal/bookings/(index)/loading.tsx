import { PortalLoading } from "@/components/partners/PortalLoading";

/**
 * The registers' skeleton. Inside the `(index)` group so it wraps the list
 * alone: above `[reference]` it would answer a missing booking with a 200
 * before the page's 404 was known.
 */
export default function Loading() {
  return <PortalLoading />;
}
