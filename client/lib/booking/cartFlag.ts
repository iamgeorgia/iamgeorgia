/**
 * Whether the public cart is open.
 *
 * `NEXT_PUBLIC_CART_ENABLED=true` at build time. One place to read it, so the
 * header icon, the "Add to cart" buttons and the two cart routes all agree:
 * off, none of them exist, and `/cart` is a 404 rather than an empty page
 * pointing at buttons that are not there.
 *
 * The server has its own `CART_ENABLED`; this one exists so the buttons never
 * appear against an API that would answer 404 `CART_DISABLED`. Both must be on.
 */
export const cartEnabled = process.env.NEXT_PUBLIC_CART_ENABLED === "true";
