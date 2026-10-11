import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dateTimeFormat, numberFormat } from "../lib/intl";
import { formatMoney } from "../lib/money";
import { formatStayDate } from "../lib/booking/stay";

/**
 * Georgian formatting must not depend on the runtime's ICU data: Node has
 * `ka`, Chromium does not, and a Server Component hydrated in Chrome used to
 * render one string on the server and another in the browser (React #418).
 * These are the strings Node's ICU produced for ka-GE before the change, so
 * the server output is unchanged and the browser now matches it.
 */
describe("Georgian formatting without ICU", () => {
  it("formats money the Georgian way: space groups, comma decimal, lari symbol last", () => {
    assert.equal(formatMoney(123_456_750, "GEL", "ka-GE"), "1 234 567,50 ₾");
    assert.equal(formatMoney(123_450, "GEL", "ka"), "1 234,50 ₾");
    assert.equal(formatMoney(123_450, "USD", "ka-GE"), "1 234,50 US$");
    assert.equal(numberFormat("ka-GE", { style: "percent" }).format(0.125), "13%");
    assert.equal(numberFormat("ka-GE").format(1234567.891), "1 234 567,891");
  });

  it("names months and weekdays in Georgian", () => {
    const date = new Date(Date.UTC(2026, 10, 15, 13, 5));
    assert.equal(dateTimeFormat("ka-GE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date), "15 ნოე 2026");
    assert.equal(dateTimeFormat("ka-GE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date), "15 ნოემბერი 2026");
    assert.equal(dateTimeFormat("ka-GE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date), "კვი 15 ნოე, 13:05");
    assert.equal(dateTimeFormat("ka-GE", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(date), "15 ნოემბერი 2026, 13:05");
    assert.equal(formatStayDate("2027-06-04", "ka-GE"), "4 ივნ 2027");
  });

  it("leaves other locales to ICU", () => {
    assert.equal(formatMoney(123_450, "GEL", "en-GB"), "GEL 1,234.50");
    assert.equal(dateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 15))), "15 Nov");
  });
});
