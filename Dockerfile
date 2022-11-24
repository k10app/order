FROM node:current-alpine
RUN mkdir /order
WORKDIR /order
COPY ["server.js","package.json","/order/"]
RUN npm install
VOLUME /order/certificates
ENV PUBLIC_KEY /order/certificates/public.pub
ENV SERVER_PORT=80

ENV POSTGRES_HOST=localhost
ENV POSTGRES_PORT=3306
ENV POSTGRES_DATABASE=userdb
ENV POSTGRES_USER=userdblogin
ENV POSTGRES_PASSWORD=userdbpassword
ENV POSTGRES_ROOT_PASSWORD=userdbrootpass
ENV ROUTE_PREFIX=/order

EXPOSE ${SERVER_PORT}
CMD ["node","/order/server.js"]