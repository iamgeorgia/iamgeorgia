import { redirect } from "next/navigation";
import { Clock, PauseCircle, PenLine, XCircle } from "lucide-react";

import { PortalStatusPanel } from "@/components/partners/PortalStatusPanel";
import { Container } from "@/components/ui/Container";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { homePathFor } from "@/types/auth";

/**
 * What a partner sees when they sign in.
 *
 * One page with several outcomes, because "what is happening with my
 * application?" is the whole product until it is approved. Only APPROVED falls
 * through to the platform itself.
 */
export default async function PortalHomePage() {
  const session = await getSession();
  const locale = await getLocale();

  if (!session) redirect(localePath(locale, "/portal/sign-in"));

  if (!session.partner) {
    redirect(localePath(locale, homePathFor(session)));
  }

  const partner = session.partner;

  if (partner.status === "APPROVED") {
    redirect(localePath(locale, "/portal/dashboard"));
  }

  const panels = {
    PENDING_APPROVAL: {
      icon: Clock,
      tone: "attention" as const,
      title: "Your application is under review",
      body: "Our partnerships team checks every application by hand, including verifying your registration number against the public register. We will email you as soon as there is a decision.",
      note: null,
    },
    REGISTRATION_IN_PROGRESS: {
      icon: PenLine,
      tone: "info" as const,
      title: "Your registration is not finished",
      body: "We have some of your details but not all of them. Open the registration link we emailed you to finish, or ask us to send a new one.",
      note: null,
    },
    INVITED: {
      icon: PenLine,
      tone: "info" as const,
      title: "Your registration is not finished",
      body: "Open the registration link we emailed you to complete your company details.",
      note: null,
    },
    REJECTED: {
      icon: XCircle,
      tone: "critical" as const,
      title: "Your application was not approved",
      body: "We were not able to approve this application. If you believe that was a mistake, or your circumstances have changed, reply to the email we sent and we will take another look.",
      note: partner.review.rejectionReason,
    },
    SUSPENDED: {
      icon: PauseCircle,
      tone: "critical" as const,
      title: "Your account is suspended",
      body: "Access to the platform has been withdrawn for now. Get in touch with your contact at I am Georgia to resolve it.",
      note: partner.review.suspensionReason,
    },
  } as const;

  const panel = panels[partner.status as keyof typeof panels];

  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <PortalStatusPanel
          icon={panel.icon}
          tone={panel.tone}
          title={panel.title}
          body={panel.body}
          note={panel.note}
          partner={partner}
        />
      </div>
    </Container>
  );
}
