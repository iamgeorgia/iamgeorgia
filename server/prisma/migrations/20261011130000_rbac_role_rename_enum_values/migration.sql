-- The staff roles the business names: the finance desk is the accountant,
-- the reservations desk is the tour operator (widened in the next commit to
-- tours and the fleet), and a finance operator confirms the day's payments.
--
-- In their own migration, before anything that uses them: Postgres refuses to
-- use a value added to an enum inside the transaction that added it, and the
-- CHECK recreated in the next migration names the new one. A rename keeps
-- every row and every stored expression that referred to the old label.
ALTER TYPE "role" RENAME VALUE 'FINANCE' TO 'ACCOUNTANT';
ALTER TYPE "role" RENAME VALUE 'RESERVATIONS' TO 'TOUR_OPERATOR';
ALTER TYPE "role" ADD VALUE 'FINANCE_OPERATOR';
