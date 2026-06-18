# =============================================================================
# Frontend image - multi-stage: build with Node, serve with Nginx.
# =============================================================================
FROM node:20-alpine AS build

WORKDIR /app

# The API base URL is baked at build time (Vite env var).
ARG VITE_API_URL=http://localhost:8000/api/v1
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# --- Serve stage ---
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
