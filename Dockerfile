FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY seed-media ./seed-media
RUN mkdir -p data uploads
EXPOSE 8787
CMD ["node", "src/server.js"]
