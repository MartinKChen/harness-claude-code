# syntax=docker/dockerfile:1.7
# Multi-stage build for a React+Vite SPA:
# - builder stage compiles the bundle
# - final stage serves the static bundle via nginx running as non-root

ARG NODE_VERSION=22
ARG NGINX_VERSION=1.27-alpine

FROM node:${NODE_VERSION}-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .
RUN npm run build

FROM nginx:${NGINX_VERSION} AS final

# nginx:alpine ships an `nginx` user (uid 101). Run as that user; that means
# the pid file MUST live somewhere the user can write. /tmp is the safe choice.
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

# /var/cache/nginx and /var/run/nginx need to be writable by the nginx user.
RUN chown -R nginx:nginx /var/cache/nginx /usr/share/nginx/html \
 && touch /tmp/nginx.pid \
 && chown nginx:nginx /tmp/nginx.pid

USER nginx
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
