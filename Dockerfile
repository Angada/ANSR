# Q&ANSR app — Node/Express container
FROM node:20-slim
WORKDIR /srv

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=4100
EXPOSE 4100
CMD ["node", "server/index.js"]
