import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Lets plain Node load the client's TypeScript the way the bundler does.
 *
 * Node 24 strips types natively, but it resolves specifiers literally:
 * `./types` is not `./types.ts`, and `@/lib/x` is not a path at all. The
 * source keeps the bundler's extensionless style, so this hook — loaded
 * with `--import` before the tests — tries `.ts` and `/index.ts` for a
 * relative specifier with no extension, and maps the `@/` alias onto the
 * client root. Nothing else changes: bare package names go to Node as they
 * are.
 *
 * `.tsx` is deliberately not tried. Node cannot strip JSX, and the modules
 * the tests load (the help registry, the navigation config) must stay free
 * of components for exactly that reason.
 */
const ROOT = new URL("../", import.meta.url);
const EXTENSIONS = [".ts", "/index.ts"];

const hasExtension = (specifier) => /\.[a-z0-9]+$/i.test(specifier);

function probe(base) {
  for (const extension of EXTENSIONS) {
    const candidate = new URL(base.href + extension);
    if (existsSync(fileURLToPath(candidate))) return candidate.href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), ROOT);
      return next(hasExtension(specifier) ? base.href : (probe(base) ?? base.href), context);
    }

    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !hasExtension(specifier)) {
      const resolved = probe(new URL(specifier, context.parentURL));
      if (resolved) return next(resolved, context);
    }

    return next(specifier, context);
  },
});
