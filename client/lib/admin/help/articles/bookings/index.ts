import type { HelpArticle } from "../../types";

import { article as bookingApprovals } from "./booking-approvals";
import { article as customers } from "./customers";
import { article as deadlinesCalendar } from "./deadlines-calendar";
import { article as deskCreateBooking } from "./desk-create-booking";
import { article as findingBookings } from "./finding-bookings";
import { article as serviceBookings } from "./service-bookings";
import { article as hotelBookingDetail } from "./hotel-booking-detail";
import { article as hotelBookingsRegister } from "./hotel-bookings-register";
import { article as orderDetail } from "./order-detail";
import { article as reminderSchedule } from "./reminder-schedule";
import { article as ordersRegister } from "./orders-register";
import { article as statusesGlossary } from "./statuses-glossary";
import { article as tourBookingDetail } from "./tour-booking-detail";
import { article as tourBookingsRegister } from "./tour-bookings-register";
import { article as transferBookingDetail } from "./transfer-booking-detail";
import { article as transferBookingsRegister } from "./transfer-bookings-register";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [
  bookingApprovals,
  findingBookings,
  deskCreateBooking,
  customers,
  hotelBookingsRegister,
  hotelBookingDetail,
  ordersRegister,
  orderDetail,
  tourBookingsRegister,
  tourBookingDetail,
  transferBookingsRegister,
  transferBookingDetail,
  serviceBookings,
  deadlinesCalendar,
  reminderSchedule,
  statusesGlossary,
];
