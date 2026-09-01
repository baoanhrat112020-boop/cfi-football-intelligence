FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=7860 \
    CFI_HF_SHADOW_MODE=1 \
    CFI_HF_ARTIFACT_ROOT=/artifacts

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /artifacts && node --experimental-strip-types cfi-hf-shadow-node/src/self-check.mjs

EXPOSE 7860
CMD ["node", "--experimental-strip-types", "cfi-hf-shadow-node/src/server.mjs"]
