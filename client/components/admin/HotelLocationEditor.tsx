"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormError, SubmitButton, TextInput } from "./FormControls";
import { GoogleMapsProvider } from "@/components/geo/GoogleMapsProvider";
import { LocationField } from "@/components/geo/LocationField";
import { updateHotel } from "@/lib/api/hotels";
import { ApiError, describeError } from "@/lib/api/client";
import { isPlaced, locationOf } from "@/lib/geo/place";
import type { Hotel } from "@/types/catalogue";
import type { LocationValue } from "@/types/geo";

/**
 * Where the property actually is.
 *
 * Two things are recorded, and they are not the same thing. The position —
 * searched for, or refined by dragging the pin — is what search distance, the
 * nearest-airport suggestion and a kosher package's sunset times are measured
 * from. The street address is what a guest is given, in the supplier's own
 * wording; a searched place offers its formatted address for it, but only
 * into an empty box, because "18 Kiacheli Street, entrance from the yard" is
 * not something Google can improve on.
 *
 * The position travels as a pair or not at all: the server (and a database
 * CHECK behind it) refuses half a location, and clearing the pin clears the
 * place with it.
 */
export function HotelLocationEditor({ hotel }: { hotel: Hotel }) {
  return (
    <GoogleMapsProvider>
      <Editor hotel={hotel} />
    </GoogleMapsProvider>
  );
}

function Editor({ hotel }: { hotel: Hotel }) {
  const router = useRouter();

  const [address, setAddress] = useState(hotel.address ?? "");
  const [postalCode, setPostalCode] = useState(hotel.postalCode ?? "");
  const [location, setLocation] = useState<LocationValue>(() => locationOf(hotel));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const placed = isPlaced(location);

  const save = async () => {
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      await updateHotel(hotel.id, {
        address: address.trim() || null,
        postalCode: postalCode.trim() || null,
        // An explicit null pair takes the pin off the map; the server drops
        // the place with it. An omitted pair would leave the old pin behind
        // two empty boxes.
        ...(isPlaced(location)
          ? { latitude: location.latitude, longitude: location.longitude, place: location.place }
          : { latitude: null, longitude: null }),
      });
      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        <TextInput
          id="hotel-address"
          label="Street address"
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            setSaved(false);
          }}
          placeholder="18 Kiacheli Street, Vera, Tbilisi"
          error={fieldErrors.address}
          hint="What guests are given. Filled in from the place search when empty, and yours to reword."
        />

        <TextInput
          id="hotel-postal-code"
          label="Postal code"
          className="sm:max-w-48"
          value={postalCode}
          onChange={(event) => {
            setPostalCode(event.target.value);
            setSaved(false);
          }}
          placeholder="0108"
          error={fieldErrors.postalCode}
        />

        {!placed && hotel.latitude !== null && (
          <p className="text-[0.75rem] leading-relaxed text-warning-text">
            Saving now takes the property off the map. The publish checklist will ask for a position
            again.
          </p>
        )}

        <FormError message={error} />

        <div className="flex items-center gap-3">
          <SubmitButton busy={busy} saved={saved} onClick={() => void save()}>
            {busy ? "Saving…" : saved ? "Saved" : "Save location"}
          </SubmitButton>
        </div>
      </div>

      <LocationField
        label="On the map"
        ids={{ search: "hotel-place", latitude: "hotel-latitude", longitude: "hotel-longitude" }}
        value={location}
        error={fieldErrors.place ?? fieldErrors.latitude ?? fieldErrors.longitude}
        hint="Search for the property, then drag the pin to the entrance if the pin is off."
        onChange={(next, meta) => {
          setLocation(next);
          setSaved(false);

          if (meta.source === "search" && next.place) {
            if (!address.trim() && next.place.formattedAddress) setAddress(next.place.formattedAddress);
            if (!postalCode.trim() && meta.postalCode) setPostalCode(meta.postalCode);
          }
        }}
      />
    </div>
  );
}
