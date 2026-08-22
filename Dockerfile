# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# Reproducible install from the lockfile (dev deps needed to build).
RUN npm ci
COPY . .
RUN npm run build

# --- runtime stage ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Production dependencies only, from the lockfile.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Built output and package manifest (the server reads its version from package.json).
COPY --from=build /app/dist ./dist

# Run as the built-in unprivileged user rather than root.
USER node

# Default transport is stdio (the client speaks to the container over stdin/stdout):
#   docker run -i --rm --env-file .env worldpay/mcp
# For the HTTP transport instead, override the command and publish the port:
#   docker run --rm -p 3001:3001 -e HOST=0.0.0.0 --env-file .env worldpay/mcp node dist/server-http.js
#   (HOST=0.0.0.0 is needed so the container binds a mappable interface; keep it
#    behind an authenticating reverse proxy — never expose /mcp directly.)
# (HTTP requires MCP_AUTH_TOKEN; see .env.example. HEALTHCHECK is intentionally
#  omitted because the default stdio server opens no port to probe.)
EXPOSE 3001

CMD ["node", "dist/server-stdio.js"]
