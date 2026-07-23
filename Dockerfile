# syntax=docker/dockerfile:1
FROM node:20-alpine AS production

ENV NODE_ENV=production \
    PORT=5550 \
    HOST=0.0.0.0 \
    UPLOAD_DIR=/app/uploads

WORKDIR /app

# Install only locked production dependencies. Keeping this layer before the
# source copy makes rebuilds fast when application code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY --chown=node:node src ./src
COPY --chown=node:node seed ./seed

RUN mkdir -p /app/uploads && chown -R node:node /app

USER node

EXPOSE 5550

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5550)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
