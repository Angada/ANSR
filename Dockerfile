# Q&ANSR app — Node/Express container.
# Node 22+ required: @supabase/supabase-js needs a native global WebSocket
# (Node 20 throws "without native WebSocket support" on client init).
FROM node:22-slim
WORKDIR /srv

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=4100
EXPOSE 4100
CMD ["node", "server/index.js"]
