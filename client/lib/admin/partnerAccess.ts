import type { PickerOption } from "@/components/admin/EntityPicker";
import { apiFetch } from "@/lib/api/client";
import { toQueryString } from "@/lib/api/query";
import {
  searchHotelOptions,
  searchServiceOptions,
  searchTourOptions,
} from "@/lib/admin/catalogue";
import type { Paginated } from "@/types/partner";
import type { ProductAccessType } from "@/types/partner";
import type { PackageSummary } from "@/types/package";
import type { TransferVehicle } from "@/types/transfer";

/**
 * Vocabulary and product search for the "what may this partner sell" panel.
 *
 * Hotels, tours and services reuse the catalogue pickers. Packages and transfer
 * vehicle classes had no browser-side search, so they are here.
 */

export const productTypeLabels: Record<ProductAccessType, string> = {
  HOTEL: "Hotels",
  TOUR: "Tours",
  SERVICE: "Services",
  PACKAGE: "Packages",
  TRANSFER: "Transfer vehicle classes",
};

export const PRODUCT_TYPES = Object.keys(productTypeLabels) as ProductAccessType[];

const searchPackageOptions = async (term: string): Promise<PickerOption[]> => {
  const { data } = await apiFetch<Paginated<PackageSummary>>(
    `/api/admin/packages${toQueryString({ ...(term ? { search: term } : {}), pageSize: 20 })}`,
  );

  return data.map((pack) => ({ id: pack.id, label: pack.name, meta: pack.summary }));
};

/** The classes are few, so the list is loaded whole and filtered here. */
const searchVehicleOptions = async (term: string): Promise<PickerOption[]> => {
  const { data } = await apiFetch<{ data: TransferVehicle[] }>("/api/admin/transfers/vehicles");
  const needle = term.trim().toLowerCase();

  return data
    .filter((vehicle) => !needle || vehicle.name.toLowerCase().includes(needle))
    .slice(0, 20)
    .map((vehicle) => ({ id: vehicle.id, label: vehicle.name, meta: vehicle.vehicleClass }));
};

export const searchProductOptions: Record<ProductAccessType, (term: string) => Promise<PickerOption[]>> = {
  HOTEL: searchHotelOptions,
  TOUR: searchTourOptions,
  SERVICE: searchServiceOptions,
  PACKAGE: searchPackageOptions,
  TRANSFER: searchVehicleOptions,
};
