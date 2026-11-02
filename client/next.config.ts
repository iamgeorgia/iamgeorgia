import type { NextConfig } from "next";

/**
 * Whether the API this build talks to is on this machine. The image optimiser
 * refuses upstreams that resolve to a private address (an SSRF guard), and the
 * local media driver serves from http://localhost:5000 — so on a fresh checkout
 * every catalogue photo came back 400 ("resolved to private IP") and rendered
 * broken. The guard is relaxed only when the configured API is itself on
 * loopback, where the server already talks to it directly; a deployment
 * pointed at a public API host keeps it on.
 */
const apiIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000",
);

const nextConfig: NextConfig = {
  /**
   * A self-contained build under .next/standalone: the traced server, only the
   * node_modules it imports, and nothing else. The Dockerfile copies that
   * folder rather than the whole tree, which is the difference between a
   * 150 MB image and a 1 GB one.
   *
   * Not on Vercel: its builder does its own tracing and fails with a missing
   * `next-server.js.nft.json` when standalone output is on. Vercel sets the
   * VERCEL variable during every build, so the setting keys off that.
   */
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),

  images: {
    /**
     * Catalogue imagery comes from the media bucket the API serializes URLs
     * for; editorial imagery is still local under /public. A host that is not
     * listed here is refused by the optimiser and the image renders as
     * nothing, so this has to track MEDIA_PUBLIC_BASE_URL on the server.
     */
    remotePatterns: [
      { protocol: "https", hostname: "**.r2.dev" },
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
      // The local media driver, which a fresh checkout runs on.
      { protocol: "http", hostname: "localhost", port: "5000", pathname: "/media/**" },
    ],
    /**
     * The default breakpoint set generates far more variants than this design
     * needs — the widest element is a 100vw hero, so anything above 1920 is
     * wasted work. Trimming the list cuts first-request optimisation time
     * substantially.
     */
    deviceSizes: [640, 828, 1080, 1200, 1600, 1920],
    imageSizes: [128, 256, 384],
    /** WebP only: AVIF encoding costs far more CPU than it saves here. */
    formats: ["image/webp"],
    dangerouslyAllowLocalIP: apiIsLocal,
  },
};

export default nextConfig;
