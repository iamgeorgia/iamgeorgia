"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, BedDouble, CarFront, Compass, ConciergeBell, Plus, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  CheckboxField,
  FormError,
  NumberInput,
  SelectInput,
  SubmitButton,
  TextInput,
} from "./FormControls";
import { useCan } from "./AdminViewerContext";
import { EntityPicker, OptionChecklist } from "./EntityPicker";
import { ReadOnlyNote } from "./ReadOnlyNote";
import {
  loadRatePlanOptions,
  loadRoomTypeOptions,
  loadTourOptionOptions,
  searchHotelOptions,
  searchServiceOptions,
  searchTourOptions,
  searchTransferPointOptions,
  searchTransferRouteOptions,
} from "@/lib/admin/catalogue";
import { ApiError, describeError } from "@/lib/api/client";
import { updatePackage, type PackageComponentInput } from "@/lib/api/packages";
import { componentTypeLabels, problemLabel, quantityRuleLabels } from "@/lib/admin/packages";
import { cn } from "@/lib/utils";
import type { PackageComponent, PackageComponentType, PackageWithChecklist } from "@/types/package";

const ICONS: Record<PackageComponentType, LucideIcon> = {
  HOTEL_STAY: BedDouble,
  TRANSFER: CarFront,
  TOUR: Compass,
  SERVICE: ConciergeBell,
};

const TYPES: PackageComponentType[] = ["HOTEL_STAY", "TRANSFER", "TOUR", "SERVICE"];

const MEAL_CODES = ["RO", "BB", "HB", "HB_PLUS", "FB", "FB_PLUS", "AI", "UAI"];
const VEHICLE_CLASSES = ["ECONOMY", "COMFORT", "MINIVAN", "VAN", "GROUP", "JEEP_4X4", "VIP"];

/**
 * A slot as the form holds it.
 *
 * Ids are still ids — that is what the API takes — but each one is carried
 * beside the name the picker showed for it, so re-rendering the trigger costs
 * nothing and a reopened builder reads as "Rooms Hotel, Tbilisi" rather than
 * as a cuid. The names never leave this file: `toInput` drops them.
 */
interface SlotDraft {
  componentType: PackageComponentType;
  label: string;
  required: boolean;
  dayOffset: number;
  nights: number;
  timeOfDay: string;
  quantityRule: "ONE" | "PER_PERSON" | "PER_ROOM";
  hotelId: string;
  hotelName: string;
  allowedRoomTypeIds: string[];
  allowedRatePlanIds: string[];
  allowedMealPlanCodes: string[];
  fromPointId: string;
  fromPointName: string;
  toPointId: string;
  toPointName: string;
  routeId: string;
  routeName: string;
  allowedVehicleClasses: string[];
  tripType: string;
  tourId: string;
  tourName: string;
  allowedTourOptionIds: string[];
  serviceId: string;
  serviceName: string;
}

const emptySlot = (componentType: PackageComponentType): SlotDraft => ({
  componentType,
  label: "",
  required: true,
  dayOffset: 0,
  nights: componentType === "HOTEL_STAY" ? 1 : 0,
  timeOfDay: "",
  quantityRule: "ONE",
  hotelId: "",
  hotelName: "",
  allowedRoomTypeIds: [],
  allowedRatePlanIds: [],
  allowedMealPlanCodes: [],
  fromPointId: "",
  fromPointName: "",
  toPointId: "",
  toPointName: "",
  routeId: "",
  routeName: "",
  allowedVehicleClasses: [],
  tripType: "",
  tourId: "",
  tourName: "",
  allowedTourOptionIds: [],
  serviceId: "",
  serviceName: "",
});

const toDraft = (component: PackageComponent): SlotDraft => ({
  componentType: component.componentType,
  label: component.label,
  required: component.required,
  dayOffset: component.dayOffset,
  nights: component.nights ?? 0,
  timeOfDay: component.timeOfDay ?? "",
  quantityRule: component.quantityRule,
  hotelId: component.hotel?.id ?? "",
  hotelName: component.hotel?.name ?? "",
  allowedRoomTypeIds: component.allowedRoomTypeIds,
  allowedRatePlanIds: component.allowedRatePlanIds,
  allowedMealPlanCodes: component.allowedMealPlanCodes,
  fromPointId: component.fromPoint?.id ?? "",
  fromPointName: component.fromPoint?.name ?? "",
  toPointId: component.toPoint?.id ?? "",
  toPointName: component.toPoint?.name ?? "",
  routeId: component.route?.id ?? "",
  routeName: component.route?.title ?? "",
  allowedVehicleClasses: component.allowedVehicleClasses,
  tripType: component.tripType ?? "",
  tourId: component.tour?.id ?? "",
  tourName: component.tour?.title ?? "",
  allowedTourOptionIds: component.allowedTourOptionIds,
  serviceId: component.service?.id ?? "",
  serviceName: component.service?.name ?? "",
});

/**
 * A slot as the API wants it, with only the fields of its own type set.
 *
 * The server enforces the same rule with a CHECK constraint per type, so a
 * hotel id left over from a slot that used to be a stay would be rejected
 * rather than quietly stored. Stripping here means the operator never sees
 * that refusal for a field they cannot see either.
 */
const toInput = (draft: SlotDraft): PackageComponentInput => {
  const base = {
    componentType: draft.componentType,
    label: draft.label.trim(),
    required: draft.required,
    dayOffset: draft.dayOffset,
    timeOfDay: draft.timeOfDay.trim() || null,
    quantityRule: draft.quantityRule,
  };

  switch (draft.componentType) {
    case "HOTEL_STAY":
      return {
        ...base,
        nights: draft.nights,
        hotelId: draft.hotelId || null,
        allowedRoomTypeIds: draft.allowedRoomTypeIds,
        allowedRatePlanIds: draft.allowedRatePlanIds,
        allowedMealPlanCodes: draft.allowedMealPlanCodes,
      };
    case "TRANSFER":
      return {
        ...base,
        fromPointId: draft.fromPointId || null,
        toPointId: draft.toPointId || null,
        routeId: draft.routeId || null,
        allowedVehicleClasses: draft.allowedVehicleClasses,
        tripType: draft.tripType || null,
      };
    case "TOUR":
      return {
        ...base,
        tourId: draft.tourId || null,
        allowedTourOptionIds: draft.allowedTourOptionIds,
      };
    case "SERVICE":
    default:
      return { ...base, serviceId: draft.serviceId || null };
  }
};

/**
 * The slots a package is assembled from.
 *
 * Written whole rather than one slot at a time: the server replaces the
 * component set on every save and re-validates the lot, because a slot is
 * only coherent relative to its neighbours — a transfer on day 4 of a
 * three-night package is wrong regardless of how correct the transfer is.
 * That also makes reordering a local operation rather than a sequence of
 * index writes that could half-apply.
 *
 * A refusal is per slot: `422 { problems: [{ slotIndex, code, message }] }`,
 * which is rendered on the offending row rather than at the top of the form.
 */
export function PackageComponentsBuilder({ pkg }: { pkg: PackageWithChecklist }) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");

  const [slots, setSlots] = useState<SlotDraft[]>(() => pkg.components.map(toDraft));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<number, string[]>>({});

  const dirty = () => {
    setSaved(false);
    setProblems({});
  };

  const patch = (index: number, changes: Partial<SlotDraft>) => {
    dirty();
    setSlots((current) =>
      current.map((slot, position) => (position === index ? { ...slot, ...changes } : slot)),
    );
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;

    if (target < 0 || target >= slots.length) return;

    dirty();
    setSlots((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];

      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setProblems({});

    try {
      await updatePackage(pkg.id, { components: slots.map(toInput) });
      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        const details = caught.details as
          | { problems?: { slotIndex: number; code: string; message: string }[] }
          | undefined;

        if (details?.problems?.length) {
          const byRow: Record<number, string[]> = {};

          for (const problem of details.problems) {
            byRow[problem.slotIndex] = [
              ...(byRow[problem.slotIndex] ?? []),
              problem.message || problemLabel(problem.code),
            ];
          }

          setProblems(byRow);
          setError("Some slots cannot be saved as they stand.");
          return;
        }
      }

      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggleIn = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  return (
    <div className="flex flex-col gap-5">
      {slots.length === 0 && (
        <p className="rounded-sm border border-dashed border-line px-4 py-6 text-center text-[0.8125rem] text-muted">
          No slots yet. A package needs at least one required part before it can go on sale.
        </p>
      )}

      {/* Disabling the fieldset locks every input, picker and chip inside the
          slots; the reorder, remove and add buttons are hidden instead. */}
      <fieldset disabled={!canEdit} className="min-w-0">
      <ol className="flex flex-col gap-4">
        {slots.map((slot, index) => {
          const Icon = ICONS[slot.componentType];
          const rowProblems = problems[index] ?? [];

          return (
            <li
              key={index}
              className={cn(
                "rounded-sm border bg-surface p-4",
                rowProblems.length > 0 ? "border-error/50" : "border-line",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-sm bg-surface-soft text-brand-text">
                    <Icon size={15} aria-hidden />
                  </span>
                  <span className="text-[0.8125rem] font-semibold text-ink">
                    Slot {index}
                    <span className="ms-2 font-normal text-muted">
                      {componentTypeLabels[slot.componentType]}
                    </span>
                  </span>
                </span>

                {canEdit && (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Move slot ${index} earlier`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    className="flex size-8 items-center justify-center rounded-sm border border-line text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-35"
                  >
                    <ArrowUp size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move slot ${index} later`}
                    disabled={index === slots.length - 1}
                    onClick={() => move(index, 1)}
                    className="flex size-8 items-center justify-center rounded-sm border border-line text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-35"
                  >
                    <ArrowDown size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove slot ${index}`}
                    onClick={() => {
                      dirty();
                      setSlots((current) => current.filter((_, position) => position !== index));
                    }}
                    className="flex size-8 items-center justify-center rounded-sm border border-line text-muted transition-colors hover:border-error hover:text-error-text"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </span>
                )}
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <TextInput
                  label="Label"
                  hint="What a buyer sees on the line, e.g. “Two nights in Kazbegi”."
                  value={slot.label}
                  onChange={(event) => patch(index, { label: event.target.value })}
                />
                <SelectInput
                  label="Type"
                  value={slot.componentType}
                  options={TYPES.map((type) => ({ value: type, label: componentTypeLabels[type] }))}
                  onChange={(event) => {
                    // Switching type discards the old type's constraints
                    // rather than carrying them into a shape that cannot
                    // hold them; the server would refuse them anyway.
                    const next = emptySlot(event.target.value as PackageComponentType);
                    patch(index, { ...next, label: slot.label, dayOffset: slot.dayOffset, required: slot.required });
                  }}
                />
                <NumberInput
                  label="Day"
                  hint="0 is the arrival day."
                  min={0}
                  max={pkg.nights}
                  value={slot.dayOffset}
                  onChange={(event) => patch(index, { dayOffset: Number(event.target.value) })}
                />
                {slot.componentType === "HOTEL_STAY" ? (
                  <NumberInput
                    label="Nights"
                    min={1}
                    max={pkg.nights}
                    value={slot.nights}
                    onChange={(event) => patch(index, { nights: Number(event.target.value) })}
                  />
                ) : (
                  <TextInput
                    label="Time of day"
                    hint="Wall clock, e.g. 11:00. Blank uses the product's own default."
                    placeholder="11:00"
                    value={slot.timeOfDay}
                    onChange={(event) => patch(index, { timeOfDay: event.target.value })}
                  />
                )}
              </div>

              {/* --- what may fill the slot ------------------------------- */}
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {slot.componentType === "HOTEL_STAY" && (
                  <>
                    <EntityPicker
                      label="Hotel"
                      hint="Blank means any hotel at the package destination."
                      placeholder="Any hotel here"
                      clearLabel="Any hotel at the destination"
                      value={slot.hotelId}
                      valueLabel={slot.hotelName}
                      search={searchHotelOptions}
                      onChange={(choice) =>
                        // Changing the property invalidates both narrowings:
                        // a room type belongs to one hotel, so keeping the old
                        // ids would pin the slot to rooms in a building it no
                        // longer sells.
                        patch(index, {
                          hotelId: choice?.id ?? "",
                          hotelName: choice?.label ?? "",
                          allowedRoomTypeIds: [],
                          allowedRatePlanIds: [],
                        })
                      }
                    />
                    <OptionChecklist
                      label="Room types"
                      hint="None selected allows any room in the hotel."
                      disabledReason="Choose a hotel to narrow the rooms."
                      emptyLabel="This hotel has no rooms yet."
                      dependency={slot.hotelId}
                      load={
                        slot.hotelId ? () => loadRoomTypeOptions(slot.hotelId) : null
                      }
                      value={slot.allowedRoomTypeIds}
                      onChange={(next) => patch(index, { allowedRoomTypeIds: next })}
                    />
                    <OptionChecklist
                      label="Rate plans"
                      hint="None selected allows any plan on the allowed rooms."
                      disabledReason="Choose a hotel to narrow the plans."
                      emptyLabel="This hotel has no rate plans yet."
                      dependency={slot.hotelId}
                      load={
                        slot.hotelId ? () => loadRatePlanOptions(slot.hotelId) : null
                      }
                      value={slot.allowedRatePlanIds}
                      onChange={(next) => patch(index, { allowedRatePlanIds: next })}
                    />
                    <fieldset>
                      <legend className="block text-[0.75rem] font-semibold text-muted">Board</legend>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {MEAL_CODES.map((code) => (
                          <button
                            key={code}
                            type="button"
                            onClick={() =>
                              patch(index, {
                                allowedMealPlanCodes: toggleIn(slot.allowedMealPlanCodes, code),
                              })
                            }
                            className={cn(
                              "h-8 rounded-sm border px-2.5 text-[0.75rem] font-medium transition-colors",
                              slot.allowedMealPlanCodes.includes(code)
                                ? "border-brand bg-brand-soft text-brand-text"
                                : "border-line text-muted hover:border-ink hover:text-ink",
                            )}
                          >
                            {code}
                          </button>
                        ))}
                      </div>
                      <span className="mt-1.5 block text-[0.75rem] text-subtle">
                        None selected allows any board.
                      </span>
                    </fieldset>
                  </>
                )}

                {slot.componentType === "TRANSFER" && (
                  <>
                    <EntityPicker
                      label="From"
                      placeholder="Any pick-up"
                      clearLabel="Any pick-up point"
                      value={slot.fromPointId}
                      valueLabel={slot.fromPointName}
                      search={searchTransferPointOptions}
                      onChange={(choice) =>
                        patch(index, {
                          fromPointId: choice?.id ?? "",
                          fromPointName: choice?.label ?? "",
                        })
                      }
                    />
                    <EntityPicker
                      label="To"
                      placeholder="Any drop-off"
                      clearLabel="Any drop-off point"
                      value={slot.toPointId}
                      valueLabel={slot.toPointName}
                      search={searchTransferPointOptions}
                      onChange={(choice) =>
                        patch(index, {
                          toPointId: choice?.id ?? "",
                          toPointName: choice?.label ?? "",
                        })
                      }
                    />
                    <EntityPicker
                      label="Route"
                      hint="A curated route pins both ends and its own fares."
                      placeholder="No fixed route"
                      clearLabel="No fixed route"
                      value={slot.routeId}
                      valueLabel={slot.routeName}
                      search={searchTransferRouteOptions}
                      onChange={(choice) =>
                        patch(index, {
                          routeId: choice?.id ?? "",
                          routeName: choice?.label ?? "",
                        })
                      }
                    />
                    <SelectInput
                      label="Trip type"
                      value={slot.tripType}
                      placeholder="Product default"
                      options={[
                        { value: "ONE_WAY", label: "One way" },
                        { value: "RETURN", label: "Return" },
                      ]}
                      onChange={(event) => patch(index, { tripType: event.target.value })}
                    />
                    <fieldset className="sm:col-span-2 lg:col-span-4">
                      <legend className="block text-[0.75rem] font-semibold text-muted">
                        Vehicle classes
                      </legend>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {VEHICLE_CLASSES.map((vehicleClass) => (
                          <button
                            key={vehicleClass}
                            type="button"
                            onClick={() =>
                              patch(index, {
                                allowedVehicleClasses: toggleIn(
                                  slot.allowedVehicleClasses,
                                  vehicleClass,
                                ),
                              })
                            }
                            className={cn(
                              "h-8 rounded-sm border px-2.5 text-[0.75rem] font-medium transition-colors",
                              slot.allowedVehicleClasses.includes(vehicleClass)
                                ? "border-brand bg-brand-soft text-brand-text"
                                : "border-line text-muted hover:border-ink hover:text-ink",
                            )}
                          >
                            {vehicleClass}
                          </button>
                        ))}
                      </div>
                      <span className="mt-1.5 block text-[0.75rem] text-subtle">
                        None selected allows any class the fleet can supply.
                      </span>
                    </fieldset>
                  </>
                )}

                {slot.componentType === "TOUR" && (
                  <>
                    <EntityPicker
                      label="Tour"
                      placeholder="Any tour at the destination"
                      clearLabel="Any tour at the destination"
                      value={slot.tourId}
                      valueLabel={slot.tourName}
                      search={searchTourOptions}
                      onChange={(choice) =>
                        // Options belong to one tour, so they go with it.
                        patch(index, {
                          tourId: choice?.id ?? "",
                          tourName: choice?.label ?? "",
                          allowedTourOptionIds: [],
                        })
                      }
                    />
                    <OptionChecklist
                      className="sm:col-span-2 lg:col-span-3"
                      label="Options"
                      hint="None selected allows any active option."
                      disabledReason="Choose a tour to narrow its options."
                      emptyLabel="This tour has no options yet."
                      dependency={slot.tourId}
                      load={slot.tourId ? () => loadTourOptionOptions(slot.tourId) : null}
                      value={slot.allowedTourOptionIds}
                      onChange={(next) => patch(index, { allowedTourOptionIds: next })}
                    />
                  </>
                )}

                {slot.componentType === "SERVICE" && (
                  <>
                    <EntityPicker
                      label="Service"
                      placeholder="Choose a service"
                      value={slot.serviceId}
                      valueLabel={slot.serviceName}
                      search={searchServiceOptions}
                      onChange={(choice) =>
                        patch(index, {
                          serviceId: choice?.id ?? "",
                          serviceName: choice?.label ?? "",
                        })
                      }
                    />
                    <SelectInput
                      label="Quantity"
                      hint="How many units one booking takes."
                      value={slot.quantityRule}
                      options={(["ONE", "PER_PERSON", "PER_ROOM"] as const).map((rule) => ({
                        value: rule,
                        label: quantityRuleLabels[rule],
                      }))}
                      onChange={(event) =>
                        patch(index, {
                          quantityRule: event.target.value as SlotDraft["quantityRule"],
                        })
                      }
                    />
                  </>
                )}
              </div>

              <div className="mt-4">
                <CheckboxField
                  label="Required"
                  hint="A required part cannot be dropped by a buyer, and its loss cancels the trip."
                  checked={slot.required}
                  onChange={(next) => patch(index, { required: next })}
                />
              </div>

              {rowProblems.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {rowProblems.map((problem) => (
                    <li key={problem} role="alert" className="text-[0.75rem] text-error-text">
                      {problem}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      </fieldset>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {TYPES.map((type) => {
            const Icon = ICONS[type];

            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  dirty();
                  setSlots((current) => [...current, emptySlot(type)]);
                }}
                className="inline-flex h-10 items-center gap-2 rounded-sm border border-line px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:border-ink"
              >
                <Plus size={14} aria-hidden />
                <Icon size={14} className="text-brand-text" aria-hidden />
                {componentTypeLabels[type]}
              </button>
            );
          })}
        </div>
      )}

      <FormError message={error} />

      {canEdit ? (
        <div>
          <SubmitButton busy={busy} saved={saved} onClick={() => void save()}>
            Save parts
          </SubmitButton>
        </div>
      ) : (
        <ReadOnlyNote needs="catalogue.write" what="Editing the parts" />
      )}
    </div>
  );
}
