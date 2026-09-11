FROM node:22-alpine AS build
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN mkdir -p public && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN addgroup -S astra && adduser -S astra -G astra
COPY --from=build --chown=astra:astra /src/.next/standalone ./
COPY --from=build --chown=astra:astra /src/.next/static ./.next/static
COPY --from=build --chown=astra:astra /src/public ./public
USER astra
EXPOSE 3000
CMD ["node", "server.js"]
