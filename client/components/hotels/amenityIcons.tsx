import {
  Accessibility,
  AirVent,
  Baby,
  Bath,
  BedSingle,
  Bike,
  Briefcase,
  Building2,
  Bus,
  Car,
  CarFront,
  ChefHat,
  CigaretteOff,
  CircleCheck,
  CircleParking,
  Clock,
  Coffee,
  ConciergeBell,
  Croissant,
  Dog,
  DoorOpen,
  Dumbbell,
  Flame,
  Flower,
  GraduationCap,
  Hand,
  Key,
  Laptop,
  MountainSnow,
  MoveVertical,
  Package,
  PawPrint,
  Plane,
  PlugZap,
  Presentation,
  Refrigerator,
  Route,
  Shirt,
  ShoppingBag,
  ShowerHead,
  Sun,
  Thermometer,
  ToyBrick,
  Trees,
  Users,
  Utensils,
  UtensilsCrossed,
  Waves,
  Wifi,
  Wind,
  Wine,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { kosherFeatureIcons } from "./kosherIcons";
import { isAmenityId } from "@/data/amenities";
import type { AmenityId } from "@/types";

/** One icon per amenity key, so the same facility always looks the same. */
export const amenityIcons: Record<AmenityId, LucideIcon> = {
  wifi: Wifi,
  breakfast: Croissant,
  pool: Waves,
  parking: Car,
  freeParking: CircleParking,
  restaurant: UtensilsCrossed,
  spa: Bath,
  airConditioning: AirVent,
  gym: Dumbbell,
  bar: Wine,
  petFriendly: Dog,
  familyRooms: Users,
  airportShuttle: Plane,
  terrace: Sun,
  roomService: Coffee,
};

/**
 * The Lucide names the amenity rows carry in their `icon` column, spelled as
 * the seed writes them. Keyed by icon, not by code: many codes share one, and
 * a code added on the server with a familiar icon needs nothing here.
 */
const iconsByName: Record<string, LucideIcon> = {
  accessibility: Accessibility,
  "air-vent": AirVent,
  baby: Baby,
  bath: Bath,
  "bed-single": BedSingle,
  bike: Bike,
  briefcase: Briefcase,
  "building-2": Building2,
  bus: Bus,
  car: Car,
  "car-front": CarFront,
  "chef-hat": ChefHat,
  "cigarette-off": CigaretteOff,
  "circle-parking": CircleParking,
  clock: Clock,
  coffee: Coffee,
  "concierge-bell": ConciergeBell,
  croissant: Croissant,
  dog: Dog,
  "door-open": DoorOpen,
  dumbbell: Dumbbell,
  flame: Flame,
  flower: Flower,
  "graduation-cap": GraduationCap,
  hand: Hand,
  key: Key,
  laptop: Laptop,
  "mountain-snow": MountainSnow,
  "move-vertical": MoveVertical,
  package: Package,
  "paw-print": PawPrint,
  plane: Plane,
  "plug-zap": PlugZap,
  presentation: Presentation,
  refrigerator: Refrigerator,
  route: Route,
  shirt: Shirt,
  "shopping-bag": ShoppingBag,
  "shower-head": ShowerHead,
  sun: Sun,
  thermometer: Thermometer,
  "toy-brick": ToyBrick,
  trees: Trees,
  users: Users,
  utensils: Utensils,
  "utensils-crossed": UtensilsCrossed,
  waves: Waves,
  wifi: Wifi,
  wind: Wind,
  wine: Wine,
};

/** A plain "this property has it" mark, for a facility no map knows. */
const FallbackAmenityIcon: LucideIcon = CircleCheck;

/** `PawPrint`, `paw_print`, `lucide-paw-print` → `paw-print`. */
const iconKey = (name: string): string =>
  name
    .trim()
    .replace(/^lucide[-:]/i, "")
    .replace(/([a-z\d])([A-Z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

const lookup = (map: Record<string, LucideIcon>, key: string): LucideIcon | null =>
  Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;

/**
 * The icon for any facility, never undefined.
 *
 * A code the site knows keeps its own icon, so it looks the same on the list
 * card — which has codes only — as on the property page. Anything else takes
 * the API's icon name, then the kosher map, then a neutral mark: a facility
 * nobody has drawn yet still renders rather than crashing the page.
 */
export function amenityIcon(code: string, icon?: string | null): LucideIcon {
  if (isAmenityId(code)) return amenityIcons[code];
  return (
    (icon ? lookup(iconsByName, iconKey(icon)) : null) ??
    lookup(kosherFeatureIcons, code) ??
    FallbackAmenityIcon
  );
}
