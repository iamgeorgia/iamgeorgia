import type { HelpArticle } from "../../types";

import { article as addCar } from "./add-car";
import { article as addDriver } from "./add-driver";
import { article as carDetail } from "./car-detail";
import { article as driverDetail } from "./driver-detail";
import { article as driversRegister } from "./drivers-register";
import { article as fleetRegister } from "./fleet-register";
import { article as verificationDocuments } from "./verification-documents";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [
  fleetRegister,
  addCar,
  carDetail,
  driversRegister,
  addDriver,
  driverDetail,
  verificationDocuments,
];
