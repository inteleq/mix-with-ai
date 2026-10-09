FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json site.config.json showcase.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node packages/sdk ./packages/sdk
COPY --chown=node:node public ./public
COPY --chown=node:node docs ./docs
COPY --chown=node:node marketing ./marketing
COPY --chown=node:node README.md ./
USER node
ENV MWA_MODE=demo HOST=0.0.0.0 PORT=3008
EXPOSE 3008
CMD ["node", "server/index.mjs"]
