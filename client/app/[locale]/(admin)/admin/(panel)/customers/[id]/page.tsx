import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { EditCustomerButton } from "@/components/admin/CustomerForm";
import { Cell, DataTable, EmptyRow, Row } from "@/components/admin/DataTable";
import { ReadOnlyNote } from "@/components/admin/ReadOnlyNote";
import { getCustomer } from "@/lib/api/customers";
import { ApiError } from "@/lib/api/client";
import { approvalProductLabels, bookingApprovalHref } from "@/lib/admin/bookingApprovals";
import { formatInstant } from "@/lib/admin/bookings";
import { customerKindLabels } from "@/lib/admin/customers";
import { formatMoney } from "@/lib/money";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Customer" };

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A booking's date, whether it arrived as a calendar day or an instant. */
const formatWhen = (value: string): string => DATE.format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));

/**
 * One customer: the details the desk keeps, and every booking made for them
 * across the five products, each linking to its own register.
 */
export default async function AdminCustomerPage({ params }: PageProps<"/[locale]/admin/customers/[id]">) {
  const session = await requireScreen();
  const { id } = await params;
  const { path } = await getI18n();

  let customer;

  try {
    customer = await getCustomer(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const canEdit = can(session, "bookings.write");

  return (
    <AdminContainer>
      <AdminBreadcrumbs items={[{ label: "Customers", href: path("/admin/customers") }, { label: customer.name }]} />

      <AdminPageHeader
        title={customer.name}
        description={`${customerKindLabels[customer.kind]}${customer.contactName ? ` · ${customer.contactName}` : ""} · ${customer.email}`}
        actions={
          canEdit ? (
            <>
              <Link
                href={path(`/admin/bookings/new?customerId=${customer.id}`)}
                prefetch={false}
                className="inline-flex h-10 items-center rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
              >
                Create booking
              </Link>
              <EditCustomerButton customer={customer} />
            </>
          ) : undefined
        }
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <AdminPanel title="Bookings" description="Every booking made for this customer, newest first." bodyClassName="p-0">
            <DataTable
              columns={[
                { label: "Reference" },
                { label: "Booking" },
                { label: "Date", hideBelow: "md" },
                { label: "Status" },
                { label: "Total", align: "end" },
              ]}
              caption="Bookings for this customer"
            >
              {customer.bookings.length === 0 ? (
                <EmptyRow colSpan={5} message="No bookings yet." />
              ) : (
                customer.bookings.map((booking) => (
                  <Row key={`${booking.product}-${booking.reference}`}>
                    <Cell>
                      <Link
                        href={path(bookingApprovalHref(booking.product, booking.reference))}
                        prefetch={false}
                        className="font-medium text-ink underline-offset-4 hover:underline"
                      >
                        {booking.reference}
                      </Link>
                      <span className="ms-2 rounded-full bg-surface-soft px-2 py-0.5 text-[0.6875rem] font-medium tracking-wide text-muted uppercase">
                        {approvalProductLabels[booking.product]}
                      </span>
                    </Cell>
                    <Cell>{booking.title}</Cell>
                    <Cell hideBelow="md">{formatWhen(booking.date)}</Cell>
                    <Cell className="text-[0.8125rem] text-muted">{booking.status.replaceAll("_", " ").toLowerCase()}</Cell>
                    <Cell align="end" className="tabular-nums">
                      {formatMoney(booking.totalCents, booking.currency)}
                    </Cell>
                  </Row>
                ))
              )}
            </DataTable>
          </AdminPanel>
        </div>

        <div className="flex flex-col gap-6">
          <AdminPanel title="Details">
            <AdminDefinitionList
              items={[
                { label: "Kind", value: customerKindLabels[customer.kind] },
                ...(customer.contactName ? [{ label: "Contact", value: customer.contactName }] : []),
                {
                  label: "Email",
                  value: (
                    <a href={`mailto:${customer.email}`} className="text-ink underline-offset-4 hover:underline">
                      {customer.email}
                    </a>
                  ),
                },
                { label: "Phone", value: customer.phone ?? "—" },
                { label: "Billing address", value: customer.billingAddress ?? "—" },
                { label: "City", value: customer.city ?? "—" },
                { label: "Country", value: customer.country ?? "—" },
                { label: "Tax ID", value: customer.taxId ?? "—" },
                { label: "Added", value: formatInstant(customer.createdAt) },
              ]}
            />
            {!canEdit && <ReadOnlyNote needs="bookings.write" what="Editing a customer" className="mt-4" />}
          </AdminPanel>

          <AdminPanel title="Notes" description="For the desk only.">
            <p className="text-[0.875rem] whitespace-pre-wrap text-body">{customer.notes ?? "—"}</p>
          </AdminPanel>
        </div>
      </div>
    </AdminContainer>
  );
}
