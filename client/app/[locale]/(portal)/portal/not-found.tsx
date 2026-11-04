import { FileQuestion } from "lucide-react";

import { PortalContainer, PortalMessage } from "@/components/partners/PortalPage";
import { Button } from "@/components/ui/Button";
import { getI18n } from "@/lib/i18n/server";

/**
 * Rendered when a booking reference in the URL matches nothing the signed-in
 * partner may see — a mistyped reference, a booking that belongs to another
 * company, a stale link. Kept inside the portal shell so the partner keeps
 * their navigation, rather than falling through to the marketing site's 404
 * with its holiday photography and "ask us where to go".
 *
 * The wording deliberately does not distinguish "does not exist" from "is not
 * yours": the server answers both with a 404 so references cannot be probed,
 * and this page keeps that promise.
 */
export default async function PortalNotFound() {
  const { path } = await getI18n();

  return (
    <PortalContainer narrow>
      <PortalMessage
        icon={FileQuestion}
        title="Nothing matches that address"
        className="max-w-2xl"
        actions={
          <>
            <Button href={path("/portal/bookings")}>All bookings</Button>
            <Button href={path("/portal/dashboard")} variant="outline">
              Dashboard
            </Button>
          </>
        }
      >
        There is no booking or page at this link for your account. Check the reference, or find the
        booking from your list.
      </PortalMessage>
    </PortalContainer>
  );
}
