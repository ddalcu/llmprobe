# Build from the repo root: the pages render with llmprobe's own report code in ../src.
#   docker build -f server/Dockerfile .
FROM node:22-alpine

WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY src /app/src
COPY server .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
