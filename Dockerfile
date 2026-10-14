# Experimental single-workspace H2H runtime. Pin image digest and lockfile before production.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force
COPY --chown=node:node README.md slack-app-manifest.yml ./
COPY --chown=node:node src ./src
COPY --chown=node:node sql ./sql
USER node
EXPOSE 3000
CMD ["npm","run","slack"]
