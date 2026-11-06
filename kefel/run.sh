#!/usr/bin/with-contenv bashio

bashio::log.info "Starting Kefel on ingress port 8099 (data in /data)"
exec node /app/server/main.js
