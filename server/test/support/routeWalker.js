import { Router } from 'express';

/**
 * Every endpoint the API mounts, as `{ method, path }`.
 *
 * Express 5 routers keep a matcher function per mounted layer and forget the
 * string it was built from, so the mount prefixes cannot be read back off the
 * stack. They can be seen going in: `Router.prototype.use` is wrapped before
 * `routes/index.js` is imported, so every `router.use('/prefix', child)` call
 * is recorded, and the full path of a route is its own path under the chain
 * of prefixes that led to its router. Imports are dynamic for that reason —
 * a static import of the routes would run before the wrap.
 */
const mounts = new Map(); // child router → [{ parent, prefix }]
const proto = Router.prototype ?? Object.getPrototypeOf(Router());

const originalUse = proto.use;

proto.use = function use(...args) {
    const [first, ...rest] = args;
    const prefixes = typeof first === 'string' ? [first] : Array.isArray(first) ? first : null;
    const handlers = prefixes ? rest : args;

    for (const handler of handlers.flat()) {
        if (handler && typeof handler.handle === 'function' && Array.isArray(handler.stack)) {
            const list = mounts.get(handler) ?? [];
            for (const prefix of prefixes ?? ['']) {
                list.push({ parent: this, prefix });
            }
            mounts.set(handler, list);
        }
    }

    return originalUse.apply(this, args);
};

const join = (prefix, path) => {
    const joined = `${prefix}${path === '/' ? '' : path}`;
    return joined === '' ? '/' : joined.replace(/\/{2,}/g, '/');
};

const walk = (router, prefix, out, seen) => {
    if (seen.has(router)) {
        return;
    }
    seen.add(router);

    for (const layer of router.stack) {
        if (layer.route) {
            for (const method of Object.keys(layer.route.methods)) {
                out.push({ method: method.toUpperCase(), path: join(prefix, layer.route.path) });
            }
            continue;
        }

        const child = layer.handle;

        if (child && Array.isArray(child.stack)) {
            const here = (mounts.get(child) ?? []).filter((m) => m.parent === router);
            for (const { prefix: childPrefix } of here.length ? here : [{ prefix: '' }]) {
                walk(child, join(prefix, childPrefix), out, new Set(seen));
            }
        }
    }
};

/** Loads the API router and lists its endpoints under `/api`. */
export const listEndpoints = async () => {
    const { routes } = await import('../../routes/index.js');
    const out = [];

    walk(routes, '/api', out, new Set());

    const unique = new Map();
    for (const endpoint of out) {
        unique.set(`${endpoint.method} ${endpoint.path}`, endpoint);
    }

    return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
};
