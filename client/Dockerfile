# syntax=docker/dockerfile:1.7
#
# The Next.js image, built with `output: "standalone"` so the runtime stage
# carries only the traced server, its node_modules and the static assets.
#
#   docker build --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t iamgeorgia-web .
#   docker run -p 3000:3000 iamgeorgia-web
#
# NEXT_PUBLIC_API_URL is inlined into the browser bundle at build time, so it
# is a build argument, not a runtime variable: changing it means rebuilding.

ARG NODE_IMAGE=node:24-bookworm-slim

# --- deps --------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build -------------------------------------------------------------------
FROM deps AS build
ARG NEXT_PUBLIC_API_URL
# Optional: without a key the location screens fall back to typed coordinates.
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
ARG NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY} \
    NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=${NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID} \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
