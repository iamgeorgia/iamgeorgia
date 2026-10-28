import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { connect, disconnect } from './db/index.js';
import { disconnectRateLimitStore } from './middleware/rateLimit.js';
import { auditSweep, sweepExpiredHolds } from './services/hotel/availability.service.js';
import { sweepExpiringCertifications } from './services/hotel/kosher.service.js';
import { drainOutbox } from './services/notifications/outbox.service.js';
import { sweepReminders } from './services/transfer/reminder.service.js';
import { sweepFinanceReminders } from './services/finance/reminder.service.js';
import { applySyncEvents, pollInvoices } from './services/invoicing/sync.service.js';
import { auditTourSweep, sweepExpiredTourHolds } from './services/tour/availability.service.js';
import { sweepCompletedTourBookings, sweepOverdueTourRequests } from './services/tour/booking.service.js';
import { sweepCompletedHotelBookings } from './services/hotel/booking.service.js';
import { sweepCompletedServiceBookings } from './services/service/booking.service.js';
import { sweepCompletedOrders, sweepOverdueOrderRequests } from './services/order/order.service.js';
import { sweepBookingApprovals } from './services/booking/approval.service.js';
import { reconcileBookingIndex } from './services/booking/index.service.js';
import { sweepDeadlineReminders } from './services/booking/deadline.service.js';
import { sweepPackagePriceFrom } from './services/package/priceFrom.service.js';

const start = async () => {
    await connect();

    const app = createApp();
    const server = app.listen(config.port, () => {
        logger.info(`Server is running on http://localhost:${config.port}`);
    });

    // How long a client may take to send a whole request. Node defaults to
    // five minutes, which lets a slow-loris client pin a socket for the
    // duration. The headers window is Node's own default unless the whole
    // request is allowed less than that — headers cannot be given longer than
    // the request they belong to.
    server.requestTimeout = config.requestTimeoutMs;
    server.headersTimeout = Math.min(server.headersTimeout, config.requestTimeoutMs);

    /**
     * Returns expired holds to the pool.
     *
     * Lives here rather than in a request path because it is process
     * lifecycle, not something a visitor triggers. `held_units` is a counter,
     * so until this runs an abandoned checkout still blocks its rooms — this
     * interval is the worst-case delay before one comes back.
     *
     * Safe to run on every instance: the sweep takes a Postgres advisory lock
     * and any instance that does not get it does nothing.
     */
    const sweeper = setInterval(() => {
        sweepExpiredHolds()
            .then(({ swept }) => auditSweep(swept))
            .catch((err) => logger.error({ err }, 'Hold sweep failed'));
    }, config.hotel.holdSweepIntervalMs);

    // Never hold the process open for a sweep that has not fired yet.
    sweeper.unref();

    /**
     * Says when a kosher certificate is about to lapse.
     *
     * Unlike the hold sweep this one **changes no state**. Expiry is derived on
     * every read, so a lapsed certificate stops counting as verified the moment
     * it lapses whether or not this has run — which is deliberate, because a job
     * that has to run for the data to be right is a job whose failure is
     * invisible. What this adds is a human hearing about it first.
     *
     * Same advisory-lock discipline as the hold sweep, so every instance may run
     * it and only one will.
     */
    const certificationSweeper = setInterval(() => {
        sweepExpiringCertifications()
            .then(({ notified, skipped }) => {
                if (!skipped && notified > 0) {
                    logger.info({ notified }, 'Kosher certificate expiry notices recorded');
                }
            })
            .catch((err) => logger.error({ err }, 'Kosher certificate sweep failed'));
    }, config.hotel.certificationSweepIntervalMs);

    certificationSweeper.unref();

    /**
     * Turns dispatch events into emails and in-app notices.
     *
     * The events were written in the same transaction as the state change
     * they describe; this is the other half. Same advisory-lock discipline:
     * every instance may run it and only one will.
     */
    const outboxDrainer = setInterval(() => {
        drainOutbox().catch((err) => logger.error({ err }, 'Outbox drain failed'));
    }, config.transfer.dispatch.outboxDrainIntervalMs);

    outboxDrainer.unref();

    /** Reminders, driver details and "still no driver" alerts, by the clock. */
    const reminderSweeper = setInterval(() => {
        sweepReminders().catch((err) => logger.error({ err }, 'Transfer reminder sweep failed'));
    }, config.transfer.dispatch.reminderSweepIntervalMs);

    reminderSweeper.unref();

    /**
     * Supplier payment reminders and overdue alerts. Every instance may run
     * it: the claims are unique rows, so even two sweeps without the lock
     * would remind once. Logged when it did something, because a finance
     * desk asking "why was I not reminded" is answered from the log.
     */
    const financeReminderSweeper = setInterval(() => {
        sweepFinanceReminders()
            .then(({ skipped, events, overdue, receivablesOverdue }) => {
                if (!skipped && events + overdue + receivablesOverdue > 0) {
                    logger.info({ events, overdue, receivablesOverdue }, 'Finance reminders queued');
                }
            })
            .catch((err) => logger.error({ err }, 'Finance reminder sweep failed'));
    }, config.finance.reminderSweepIntervalMs);

    financeReminderSweeper.unref();

    /**
     * Invoicing: the stored status reports from InvoiceOcean are applied
     * every minute, and InvoiceOcean is polled for the ones its webhook
     * never delivered. Neither runs while invoicing is switched off — there
     * is nothing to apply and nobody to ask.
     */
    const invoiceSyncApplier = config.finance.invoiceocean.enabled
        ? setInterval(() => {
              applySyncEvents()
                  .then(({ skipped, applied, failed }) => {
                      if (!skipped && applied + failed > 0) logger.info({ applied, failed }, 'Invoice status events applied');
                  })
                  .catch((err) => logger.error({ err }, 'Invoice sync apply failed'));
          }, config.finance.invoiceocean.syncApplyIntervalMs)
        : null;

    const invoicePoller = config.finance.invoiceocean.enabled
        ? setInterval(() => {
              pollInvoices()
                  .then(({ skipped, stored }) => {
                      if (!skipped && stored > 0) logger.info({ stored }, 'Invoice changes found by polling');
                  })
                  .catch((err) => logger.error({ err }, 'Invoice poll failed'));
          }, config.finance.invoiceocean.pollIntervalMs)
        : null;

    invoiceSyncApplier?.unref();
    invoicePoller?.unref();

    /** Tour holds: the same counter-and-sweeper discipline as room holds. */
    const tourHoldSweeper = setInterval(() => {
        sweepExpiredTourHolds()
            .then(({ swept }) => auditTourSweep(swept))
            .catch((err) => logger.error({ err }, 'Tour hold sweep failed'));
    }, config.tour.holdSweepIntervalMs);

    tourHoldSweeper.unref();

    /** Rolls tours whose last day has passed to COMPLETED. */
    const tourCompletionSweeper = setInterval(() => {
        sweepCompletedTourBookings().catch((err) => logger.error({ err }, 'Tour completion sweep failed'));
    }, config.tour.completionSweepIntervalMs);

    tourCompletionSweeper.unref();

    /** Tells operations about on-request bookings nobody has answered in time. */
    const tourRequestSweeper = setInterval(() => {
        sweepOverdueTourRequests().catch((err) => logger.error({ err }, 'Tour request sweep failed'));
    }, config.tour.requestSweepIntervalMs);

    tourRequestSweeper.unref();

    /**
     * Booking approvals (OD1): operations are told about bookings nobody has
     * answered in time, and a booking still waiting when its service date
     * has passed is rejected at no charge — nobody can approve a stay that
     * has already begun. Nothing runs while approval is switched off.
     */
    const approvalSweeper = config.booking.approvalEnabled
        ? setInterval(() => {
              sweepBookingApprovals()
                  .then(({ alerted, expired }) => {
                      if (alerted + expired > 0) logger.info({ alerted, expired }, 'Booking approvals swept');
                  })
                  .catch((err) => logger.error({ err }, 'Booking approval sweep failed'));
          }, config.booking.approvalSweepIntervalMs)
        : null;

    approvalSweeper?.unref();

    /**
     * Deadline reminders: payment, free cancellation and confirmation, on
     * the schedule in `reminder_policies`. Claims are unique rows, so two
     * instances cannot remind twice. Off until the calendar ships.
     */
    const deadlineSweeper = config.booking.deadlineRemindersEnabled
        ? setInterval(() => {
              sweepDeadlineReminders()
                  .then(({ skipped, events, missed }) => {
                      if (!skipped && events + missed > 0) logger.info({ events, missed }, 'Deadline reminders queued');
                  })
                  .catch((err) => logger.error({ err }, 'Deadline reminder sweep failed'));
          }, config.booking.deadlineSweepIntervalMs)
        : null;

    deadlineSweeper?.unref();

    /** Orders: the on-request queue's overdue alert, and completion once every part has finished. */
    const orderRequestSweeper = setInterval(() => {
        sweepOverdueOrderRequests().catch((err) => logger.error({ err }, 'Order request sweep failed'));
    }, config.order.requestSweepIntervalMs);

    orderRequestSweeper.unref();

    /**
     * Children first, then the orders made of them: a stay whose check-out
     * has passed and a service whose last day has passed roll to COMPLETED,
     * and only then is each order asked whether every surviving part is done.
     * Run the other way round, an order would wait a whole interval longer
     * than it needed to.
     */
    /**
     * The booking index is kept in step by the services; this catches what
     * they missed — a crash between a write and its sync — by rebuilding
     * every row whose booking moved in the last day and a half.
     */
    const indexReconciler = setInterval(() => {
        reconcileBookingIndex()
            .then((counts) => {
                const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
                if (total > 0) logger.info({ counts }, 'Booking index reconciled');
            })
            .catch((err) => logger.error({ err }, 'Booking index reconcile failed'));
    }, 24 * 60 * 60 * 1000);

    indexReconciler.unref();

    const orderCompletionSweeper = setInterval(() => {
        sweepCompletedHotelBookings()
            .then(({ completed }) => {
                if (completed > 0) logger.info({ completed }, 'Hotel stays completed');
            })
            .then(() => sweepCompletedServiceBookings())
            .then(() => sweepCompletedOrders())
            .catch((err) => logger.error({ err }, 'Order completion sweep failed'));
    }, Math.min(config.hotel.completionSweepIntervalMs, config.order.completionSweepIntervalMs));

    orderCompletionSweeper.unref();

    /** The indicative "from" price on package cards: a few sample dates, refreshed daily and once soon after boot. */
    const refreshPackagePrices = () =>
        sweepPackagePriceFrom()
            .then(({ refreshed, total }) => logger.info({ refreshed, total }, 'Package prices refreshed'))
            .catch((err) => logger.error({ err }, 'Package price sweep failed'));
    const packagePriceKickoff = setTimeout(refreshPackagePrices, 30_000);
    const packagePriceSweeper = setInterval(refreshPackagePrices, config.package.priceFromSweepIntervalMs);

    packagePriceKickoff.unref();
    packagePriceSweeper.unref();

    let shuttingDown = false;

    const shutdown = async (reason, exitCode = 0) => {
        if (shuttingDown) {
            return;
        }

        shuttingDown = true;
        logger.info({ reason }, 'Shutting down');
        clearInterval(sweeper);
        clearInterval(certificationSweeper);
        clearInterval(outboxDrainer);
        clearInterval(reminderSweeper);
        clearInterval(financeReminderSweeper);
        if (invoiceSyncApplier) clearInterval(invoiceSyncApplier);
        if (invoicePoller) clearInterval(invoicePoller);
        clearInterval(tourHoldSweeper);
        clearInterval(tourCompletionSweeper);
        clearInterval(tourRequestSweeper);
        clearInterval(orderRequestSweeper);
        clearInterval(orderCompletionSweeper);
        clearTimeout(packagePriceKickoff);
        clearInterval(packagePriceSweeper);

        // A client holding a keep-alive socket can stop server.close() from
        // ever completing, so give in-flight requests a window and then take
        // the remaining sockets down.
        const forceExit = setTimeout(() => {
            logger.error('Shutdown timed out, forcing exit');
            process.exit(1);
        }, config.shutdownTimeoutMs);
        forceExit.unref();

        const closed = new Promise((resolve) => server.close(resolve));
        server.closeIdleConnections();
        const closeRemaining = setTimeout(() => server.closeAllConnections(), config.shutdownTimeoutMs / 2);

        try {
            await closed;
            clearTimeout(closeRemaining);
            await disconnect();
            await disconnectRateLimitStore();
            logger.info('Shutdown complete');
            process.exit(exitCode);
        } catch (err) {
            logger.error({ err }, 'Error during shutdown');
            process.exit(1);
        }
    };

    ['SIGINT', 'SIGTERM'].forEach((signal) => {
        process.on(signal, () => shutdown(signal));
    });

    // An uncaught exception leaves the process in an unknown state; the only
    // safe move is to log it and exit non-zero so the supervisor restarts us.
    process.on('uncaughtException', (err) => {
        logger.fatal({ err }, 'Uncaught exception');
        shutdown('uncaughtException', 1);
    });

    process.on('unhandledRejection', (reason) => {
        logger.fatal({ err: reason }, 'Unhandled rejection');
        shutdown('unhandledRejection', 1);
    });

    return server;
};

start().catch((err) => {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
});
