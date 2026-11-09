# The web app: build with Node, serve with nginx.
# nginx also forwards /api and /static to the API, so the browser sees one
# origin and the HttpOnly refresh cookie + CSRF cookie work (see vite.config.ts).

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
