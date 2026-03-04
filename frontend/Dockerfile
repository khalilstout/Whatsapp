FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json ./
RUN npm install

COPY . .

# VITE_BACKEND_URL will be injected at runtime via nginx, not at build time
# We build without it and let nginx proxy handle /socket.io/
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM nginx:1.25-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
