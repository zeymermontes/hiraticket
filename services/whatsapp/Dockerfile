# WhatsApp worker (Baileys) — no browser needed, so a plain slim Node image.
FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

CMD ["node", "index.js"]
