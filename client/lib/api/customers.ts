import { apiFetch, serverFetch } from "./client";
import { toQueryString } from "./query";
import type { Customer, CustomerDetail, CustomerInput, CustomerQuery } from "@/types/customer";
import type { Paginated } from "@/types/partner";

/**
 * Desk customers: the people and companies a manual booking is made for when
 * the buyer has no partner account. Read by whoever reads bookings
 * (`bookings.read`), written by the desk (`bookings.write`).
 */

export const listCustomers = (query: CustomerQuery = {}) =>
  serverFetch<Paginated<Customer>>(`/api/admin/customers${toQueryString(query)}`);

/** The customer with its bookings across every product. */
export const getCustomer = (id: string) => serverFetch<CustomerDetail>(`/api/admin/customers/${id}`);

/** The same list from the browser, for the buyer picker on the desk. */
export const listCustomersClient = (query: CustomerQuery = {}) =>
  apiFetch<Paginated<Customer>>(`/api/admin/customers${toQueryString(query)}`);

export const createCustomer = (body: CustomerInput) =>
  apiFetch<Customer>("/api/admin/customers", { method: "POST", body });

export const updateCustomer = (id: string, body: Partial<CustomerInput>) =>
  apiFetch<Customer>(`/api/admin/customers/${id}`, { method: "PATCH", body });
