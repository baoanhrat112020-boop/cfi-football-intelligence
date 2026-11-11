FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=7860 \
    CFI_HF_SHADOW_MODE=1 \
    CFI_HF_ARTIFACT_ROOT=/home/node/artifacts

RUN mkdir -p /home/node/app /home/node/artifacts && chown -R node:node /home/node/app /home/node/artifacts
USER node
WORKDIR /home/node/app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
RUN node --experimental-strip-types cfi-hf-shadow-node/src/self-check.mjs

EXPOSE 7860
CMD ["node", "--experimental-strip-types", "cfi-hf-shadow-node/src/server.mjs"]
