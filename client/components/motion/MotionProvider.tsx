"use client";

import { LazyMotion } from "framer-motion";

const loadFeatures = () => import("./features").then((module) => module.default);

/**
 * Makes the `m` components animate.
 *
 * Every animated component in the app uses `m.div` rather than `motion.div`.
 * `m` is a few kilobytes and renders its markup immediately; the engine that
 * drives it arrives through `loadFeatures` as a separate chunk once the page
 * is interactive. Before it lands an `m` element simply sits at its target
 * state, which is what a visitor sees anyway on a page they have just opened.
 *
 * `strict` throws in development if a `motion.*` component slips in, because
 * that would silently pull the full library back into the first load.
 *
 * Mounted by the route groups that animate — the public site, the admin
 * panel and the partner portal. The driver app has no animated component and
 * mounts nothing.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      {children}
    </LazyMotion>
  );
}
