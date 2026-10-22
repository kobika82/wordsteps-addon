#!/usr/bin/with-contenv bashio

bashio::log.info "Starting WordSteps on ingress port 8099 (data in /data)"
exec node /app/server/main.js
