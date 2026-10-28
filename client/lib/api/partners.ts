import { apiFetch, serverFetch } from "./client";
import type {
  AuditEntry,
  Invitation,
  InvitationPreview,
  Paginated,
  Partner,
  PartnerFinancial,
  PartnerKind,
  PartnerLink,
  PartnerStatus,
  PartnerSummary,
  PartnerTermsAcceptance,
  ProductAccessEntry,
  ProductAccessInput,
} from "@/types/partner";
import type { Session, SessionUser } from "@/types/auth";

/**
 * Typed calls against the partner endpoints.
 *
 * Split by where they run: `list`/`get` are read paths a Server Component uses
 * during a render, the mutations are what a Client Component fires from a
 * button. Keeping the two apart means a browser bundle never pulls in
 * `next/headers`, and a server render never silently makes an uncredentialed
 * request.
 */

export interface PartnerQuery {
  status?: PartnerStatus | PartnerStatus[];
  kind?: PartnerKind;
  country?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

const toQueryString = (query: PartnerQuery): string => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    // The server accepts `status` more than once and reads it as a set, which
    // is what the applications queue needs.
    for (const entry of Array.isArray(value) ? value : [value]) {
      params.append(key, String(entry));
    }
  }

  const search = params.toString();
  return search ? `?${search}` : "";
};

// --- Server-side reads ------------------------------------------------------

export const listPartners = (query: PartnerQuery = {}) =>
  serverFetch<Paginated<PartnerSummary>>(`/api/admin/partners${toQueryString(query)}`);

export const getPartner = (id: string) => serverFetch<Partner>(`/api/admin/partners/${id}`);

/** The same register from the browser, for a picker that searches as somebody types. */
export const listPartnersClient = (query: PartnerQuery = {}) =>
  apiFetch<Paginated<PartnerSummary>>(`/api/admin/partners${toQueryString(query)}`);

/** One partner from the browser: a filter chip naming the id the URL carries. */
export const getPartnerClient = (id: string) => apiFetch<Partner>(`/api/admin/partners/${id}`);

export const getPartnerAudit = (id: string) =>
  serverFetch<{ data: AuditEntry[] }>(`/api/admin/partners/${id}/audit`);

export const getPartnerInvitations = (id: string) =>
  serverFetch<{ data: Invitation[] }>(`/api/admin/partners/${id}/invitations`);

export const getInvitationPreview = (token: string) =>
  serverFetch<InvitationPreview>(`/api/invitations/${token}`);

export const getOwnPartner = () => serverFetch<Partner>("/api/partner/me");

export const getOwnFinancial = () => serverFetch<PartnerFinancial>("/api/partner/financial");

// --- Partner self-service ----------------------------------------------------

/**
 * What a partner may change about its own company.
 *
 * The legal entity, registration number, partner type and country are absent
 * on purpose: they are what the approval was granted against, and the server's
 * allow-list drops them even if they are sent.
 */
export interface PartnerProfileInput {
  name?: string;
  legalAddress?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string | null;
  socialLinks?: { label: string; url: string }[];
  /** The VAT or tax number printed on invoices; null removes it. */
  taxId?: string | null;
}

export const updateOwnProfile = (body: PartnerProfileInput) =>
  apiFetch<Partner>("/api/partner/profile", { method: "PATCH", body });

export interface AccountInput {
  firstName?: string;
  lastName?: string;
  position?: string | null;
  phone?: string | null;
}

export const updateOwnAccount = (body: AccountInput) =>
  apiFetch<SessionUser>("/api/partner/account", { method: "PATCH", body });

export const saveOwnFinancial = (body: Record<string, unknown>) =>
  apiFetch<PartnerFinancial>("/api/partner/financial", { method: "PUT", body });

/** Ends every other session and hands this device a fresh cookie. */
export const changePassword = (currentPassword: string, newPassword: string) =>
  apiFetch<void>("/api/auth/password/change", {
    method: "POST",
    body: { currentPassword, newPassword },
  });

// --- Browser-side mutations -------------------------------------------------

export interface AdminCreatePartnerInput {
  mode: "invite" | "activate" | "approve";
  company: Record<string, unknown>;
  contact: Record<string, unknown>;
  financial?: Record<string, unknown>;
  commissionRateBps?: number;
  notes?: string;
  /** Mode "approve" only: the filed PDF (uploaded as media first), or an explicit "not needed". */
  contract?: { assetId: string; signedAt: string; version?: string };
  contractRequired?: boolean;
  documents?: { label: string; received: boolean }[];
}

export interface CreatePartnerResult {
  partner: Partner;
  link: PartnerLink;
  /** False when the message could not be delivered — show the link instead. */
  emailSent: boolean;
}

export const createPartner = (body: AdminCreatePartnerInput) =>
  apiFetch<CreatePartnerResult>("/api/admin/partners", { method: "POST", body });

export const updatePartner = (id: string, body: Record<string, unknown>) =>
  apiFetch<Partner>(`/api/admin/partners/${id}`, { method: "PATCH", body });

/**
 * Removes a partner for good.
 *
 * `confirm` must be the partner's own reference. The server checks it against
 * the record, so this is a real guard rather than a UI formality — a DELETE
 * that names the wrong partner fails instead of destroying it.
 */
export const deletePartner = (id: string, confirm: string) =>
  apiFetch<{ deleted: true; reference: string; name: string }>(`/api/admin/partners/${id}`, {
    method: "DELETE",
    body: { confirm },
  });

export type ReviewAction = "approve" | "reject" | "suspend" | "reactivate";

export const reviewPartner = (id: string, action: ReviewAction, body: Record<string, unknown> = {}) =>
  apiFetch<Partner>(`/api/admin/partners/${id}/${action}`, { method: "POST", body });

export const resendInvitation = (id: string) =>
  apiFetch<{ link: PartnerLink; email: string; emailSent: boolean }>(
    `/api/admin/partners/${id}/invitations`,
    { method: "POST", body: {} },
  );

export const readFinancial = (id: string) =>
  apiFetch<PartnerFinancial>(`/api/admin/partners/${id}/financial`);

export const saveFinancial = (id: string, body: Record<string, unknown>) =>
  apiFetch<PartnerFinancial>(`/api/admin/partners/${id}/financial`, { method: "PUT", body });

// --- Contract, lifecycle and product access (admin) -----------------------

export interface ContractLink {
  url: string;
  expiresAt: string;
}

/** Files the signed agreement. The PDF travels as multipart, not JSON. */
export const uploadContract = (id: string, input: { file: File; signedAt: string; version?: string }) => {
  const form = new FormData();
  form.append("file", input.file);
  form.append("signedAt", input.signedAt);
  if (input.version?.trim()) form.append("version", input.version.trim());
  return apiFetch<Partner>(`/api/admin/partners/${id}/contract`, { method: "POST", rawBody: form, timeoutMs: 60_000 });
};

/** A short-lived signed link to the PDF. */
export const getContractLink = (id: string) => apiFetch<ContractLink>(`/api/admin/partners/${id}/contract`);

export const setContractRequirement = (id: string, contractRequired: boolean, reason: string) =>
  apiFetch<Partner>(`/api/admin/partners/${id}/contract-requirement`, {
    method: "PUT",
    body: { contractRequired, reason },
  });

export const blockPartner = (id: string, reason: string) =>
  apiFetch<Partner>(`/api/admin/partners/${id}/block`, { method: "POST", body: { reason } });

export const unblockPartner = (id: string) =>
  apiFetch<Partner>(`/api/admin/partners/${id}/unblock`, { method: "POST", body: {} });

/** Final. `confirm` is the partner's own reference, typed by the operator. */
export const terminatePartner = (id: string, reason: string, confirm: string) =>
  apiFetch<Partner>(`/api/admin/partners/${id}/terminate`, { method: "POST", body: { reason, confirm } });

export const getProductAccess = (id: string) =>
  apiFetch<{ data: ProductAccessEntry[] }>(`/api/admin/partners/${id}/product-access`);

/** Replaces the whole list. */
export const setProductAccess = (id: string, entries: ProductAccessInput[]) =>
  apiFetch<{ data: ProductAccessEntry[] }>(`/api/admin/partners/${id}/product-access`, {
    method: "PUT",
    body: { entries },
  });

export const getProductAccessServer = (id: string) =>
  serverFetch<{ data: ProductAccessEntry[] }>(`/api/admin/partners/${id}/product-access`);

// --- Platform terms and contract (partner portal) ---------------------------

export const getOwnTerms = () => serverFetch<PartnerTermsAcceptance>("/api/partner/terms");

export const acceptTerms = (version: string) =>
  apiFetch<Partner>("/api/partner/terms/accept", { method: "POST", body: { version } });

export const getOwnContractLink = () => apiFetch<ContractLink>("/api/partner/contract");

// --- Public registration ----------------------------------------------------

export interface RegistrationInput {
  company: Record<string, unknown>;
  contact: Record<string, unknown>;
  financial: Record<string, unknown>;
  password: string;
  /** Required: the version the applicant was shown and agreed to. */
  terms?: { accepted: true; version: string };
}

/** The same preview the page loaded, fetched again from the browser. */
export const readInvitationPreview = (token: string) =>
  apiFetch<InvitationPreview>(`/api/invitations/${token}`);

export const acceptInvitation = (token: string, body: RegistrationInput) =>
  apiFetch<{ reference: string; status: PartnerStatus; companyName: string }>(
    `/api/invitations/${token}/accept`,
    { method: "POST", body },
  );

// --- Authentication ---------------------------------------------------------

export const signIn = (email: string, password: string) =>
  apiFetch<{ user: unknown; partner: Partner | null }>("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });

export const signOut = () => apiFetch<void>("/api/auth/logout", { method: "POST" });

export const readActivation = (token: string) =>
  apiFetch<{
    email: string;
    firstName: string;
    lastName: string;
    companyName: string | null;
    expiresAt: string;
  }>(`/api/auth/activation/${token}`);

/**
 * Asks for a password-reset email. The server answers 204 whether or not the
 * address has an account, so the caller must not read anything into success.
 */
export const requestPasswordReset = (email: string) =>
  apiFetch<void>("/api/auth/password/forgot", { method: "POST", body: { email } });

/** Sets a new password from a reset link. Ends every session; the user signs in again. */
export const resetPasswordWithToken = (token: string, password: string) =>
  apiFetch<void>(`/api/auth/password/reset/${encodeURIComponent(token)}`, {
    method: "POST",
    body: { password },
  });

export const setPasswordFromActivation = (token: string, password: string) =>
  apiFetch<Session>(`/api/auth/activation/${token}`, {
    method: "POST",
    body: { password },
  });
