# WhatsApp Web worker — uses Puppeteer's image (ships Chrome + deps).
FROM ghcr.io/puppeteer/puppeteer:23.6.0

WORKDIR /app

# whatsapp-web.js drives the Chrome that ships in this base image.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

CMD ["node", "index.js"]
