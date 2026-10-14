import type { HelpArticle } from "../../types";

import { article as approvals } from "./approvals";
import { article as creditAndPenalties } from "./credit-and-penalties";
import { article as invoices } from "./invoices";
import { article as overview } from "./overview";
import { article as payables } from "./payables";
import { article as payments } from "./payments";
import { article as receivables } from "./receivables";
import { article as reminders } from "./reminders";
import { article as reports } from "./reports";
import { article as terms } from "./terms";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [overview, payables, receivables, payments, invoices, approvals, terms, reminders, reports, creditAndPenalties];
