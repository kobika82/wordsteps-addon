ARG BUILD_FROM
FROM $BUILD_FROM

RUN apk add --no-cache nodejs

WORKDIR /app
COPY server/ ./server/
COPY public/ ./public/
COPY run.sh ./
RUN chmod a+x /app/run.sh

CMD [ "/app/run.sh" ]
