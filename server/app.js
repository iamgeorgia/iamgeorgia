import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { config } from './config.js';
import { logger } from './lib/logger.js';
import { prisma } from './db/index.js';
import { routes } from './routes/index.js';
import { mediaRoutes } from './routes/media.routes.js';
import { paymentsFlittRoutes } from './routes/payments.flitt.routes.js';
import { isLocalDriver } from './services/media/storage.service.js';
import { notFoundHandler, errorHandler } from './middleware/errors.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { verifyRequestOrigin } from './middleware/csrf.js';

/**
 * Builds the Express app without starting a listener, so tests can drive it
 * over an ephemeral port (see test/) and server.js owns process lifecycle.
 */
export const createApp = () => {
    const app = express();

    app.disable('x-powered-by');

    // Behind a proxy, req.ip is the proxy's address unless this says how many
    // hops to trust — which would make every per-IP rate limit count the whole
    // internet as one client. Left false by default so a misconfiguration
    // cannot let a client spoof its own address through X-Forwarded-For.
    app.set('trust proxy', config.trustProxy);

    app.use(helmet());

    // credentials: the session is an httpOnly cookie, so the browser only
    // sends it cross-origin when the response says it may. `origin` is a
    // single exact value rather than a reflection of the request.
    app.use(cors({ origin: config.clientOrigin, credentials: true }));
    app.use(cookieParser());

    // Logging comes before anything that can reject a request, so a body that
    // blows the size limit is still attributed to a request in the logs.
    app.use(
        pinoHttp({
            logger,
            // Health checks are polled constantly; logging them buries real traffic.
            autoLogging: { ignore: (req) => req.url.startsWith('/health') }
        })
    );

    // The payment gateway's callback and the guest's return from its page:
    // before the global limiter (the gateway's addresses must not share a
    // bucket with the public), before the origin check (a browser arriving
    // from pay.flitt.com is cross-site by definition) and before the JSON
    // parser (the signature covers the raw bytes). Each has its own limiter
    // and reads its own body. See routes/payments.flitt.routes.js.
    app.use('/api/payments/flitt', paymentsFlittRoutes);

    app.use(globalLimiter);

    // Before body parsing, because a request from the wrong origin is not one
    // whose payload is worth decoding — and before the routes, so that no
    // handler has to remember this exists. Reads only headers the browser
    // controls; see middleware/csrf.js for why absent headers pass.
    app.use(verifyRequestOrigin);

    // Body parsing last: no point decoding a payload for a request that was
    // already rejected by the limiter.
    app.use(express.json({ limit: '100kb' }));

    // Liveness: the process is up. Deliberately does not touch the database,
    // so an orchestrator does not restart a healthy API over a slow query.
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', uptime: process.uptime() });
    });

    // Readiness: the API can actually serve requests. Reports its status as a
    // response rather than throwing, so it never reaches the error handler.
    app.get('/health/db', async (req, res) => {
        try {
            const [{ now }] = await prisma.$queryRaw`SELECT NOW() AS now`;
            res.json({ status: 'ok', now });
        } catch (err) {
            req.log.error({ err }, 'Database health check failed');
            res.status(503).json({ status: 'error', message: 'Database unavailable' });
        }
    });

    // Under the local storage driver the API also serves the objects it wrote,
    // standing in for the CDN and for R2's presigned URLs. Mounted outside
    // /api because these are assets, not API responses, and not mounted at all
    // under `s3` — in production these bytes never touch the app server.
    if (isLocalDriver()) {
        app.use('/media', mediaRoutes);
    }

    app.use('/api', routes);

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
};

export default createApp;
