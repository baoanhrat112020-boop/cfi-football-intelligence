FROM node:24-bookworm-slim

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    NODE_ENV=production \
    PORT=7860 \
    CFI_HF_SHADOW_MODE=1 \
    CFI_HF_ARTIFACT_ROOT=/home/user/artifacts
WORKDIR /home/user/app

COPY --chown=user package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=user . .
RUN mkdir -p /home/user/artifacts && node --experimental-strip-types cfi-hf-shadow-node/src/self-check.mjs

EXPOSE 7860
CMD ["node", "--experimental-strip-types", "cfi-hf-shadow-node/src/server.mjs"]
