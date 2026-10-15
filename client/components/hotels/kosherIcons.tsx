import {
  BookOpen,
  ChefHat,
  Church,
  Clock,
  Croissant,
  Droplets,
  Flame,
  KeyRound,
  Lamp,
  MapPin,
  MoveVertical,
  Sandwich,
  Soup,
  Spline,
  Split,
  Users,
  Utensils,
  UtensilsCrossed,
  WheatOff,
  Wine,
  ClipboardList,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * One icon per kosher facility code, mirroring the `icon` column the seed
 * writes.
 *
 * Kept beside `amenityIcons.tsx` rather than inside it: that map is typed on
 * `AmenityId`, the union of codes the site has its own copy for, and widening
 * it to `string` would remove the exhaustiveness check that stops somebody
 * adding an amenity there without an icon. `amenityIcon` there falls back to
 * this map for a kosher code shown among the general facilities.
 *
 * `kosherIcon` falls back rather than throwing. A facility seeded on the server
 * and not yet mapped here should render with a generic mark, not crash a hotel
 * page.
 */
export const kosherFeatureIcons: Record<string, LucideIcon> = {
  // Food & kitchen
  kosherRestaurant: Utensils,
  kosherKitchen: ChefHat,
  kosherBreakfast: Croissant,
  kosherLunch: Sandwich,
  kosherDinner: Soup,
  separateMeatDairy: Split,
  kosherMealOnRequest: ClipboardList,
  passoverKosher: WheatOff,
  kosherWine: Wine,

  // Shabbat
  shabbatElevator: MoveVertical,
  shabbatMeals: UtensilsCrossed,
  manualRoomKeys: KeyRound,
  shabbatLighting: Lamp,
  shabbatHotPlate: Flame,
  shabbatLateCheckout: Clock,

  // Religious facilities
  synagogueOnSite: Church,
  synagogueNearby: MapPin,
  prayerRoom: BookOpen,
  minyanDaily: Users,
  mikvehOnSite: Droplets,
  mikvehNearby: MapPin,
  eruv: Spline,
};

export const kosherIcon = (code: string): LucideIcon => kosherFeatureIcons[code] ?? BookOpen;
