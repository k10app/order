FROM node:current-alpine
RUN mkdir /order
WORKDIR /order
COPY ["server.js","basket.js","order.js","utils.js","package.json","/order/"]
RUN npm install
VOLUME /order/certificates
ENV PUBLIC_KEY /order/certificates/public.pub
ENV SERVER_PORT=80

ENV POSTGRES_HOST=localhost
ENV POSTGRES_PORT=5432
ENV POSTGRES_DATABASE=order
ENV POSTGRES_USER=orderlogin
ENV POSTGRES_PASSWORD=orderpassword

ENV ROUTE_PREFIX=/order
ENV CATALOG_PREFIX=/catalog
ENV CATALOG_SERVER=127.0.0.1
ENV CATALOG_PORT=80

EXPOSE ${SERVER_PORT}
CMD ["node","/order/server.js"]