/**
 * The Framer Motion animation engine, loaded on demand.
 *
 * `MotionProvider` imports this module lazily, so the engine is its own chunk
 * fetched after hydration rather than part of every page's first load. The
 * `domAnimation` set covers everything the site uses — enter/exit, variants,
 * gestures — without `domMax`'s layout and drag machinery, which nothing here
 * needs.
 */
export { domAnimation as default } from "framer-motion";
