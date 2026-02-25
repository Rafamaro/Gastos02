FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json vite.config.* index.html ./
COPY assets ./assets

RUN npm install
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
