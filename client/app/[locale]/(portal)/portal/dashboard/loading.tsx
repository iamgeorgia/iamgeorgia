import { PortalLoading } from "@/components/partners/PortalLoading";

/**
 * The dashboard's shape while its reads are in flight. A leaf route with no
 * dynamic children, so a boundary here cannot turn a 404 into a 200.
 */
export default function PortalDashboardLoading() {
  return <PortalLoading variant="dashboard" />;
}
