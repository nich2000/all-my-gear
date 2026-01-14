#!/bin/bash

docker run \
  --platform linux/amd64 \
  --name all-my-gear \
  -d --restart always \
  -p 443:443 \
  -v /etc/letsencrypt/live/all-my-gear.pro/fullchain.pem:/etc/ssl/certs/cert.pem:ro \
  -v /etc/letsencrypt/live/all-my-gear.pro/privkey.pem:/etc/ssl/certs/key.pem:ro \
  -e TZ=Europe/Moscow \
  -e WWW_DIR="/app/www/" \
  -e WWW_URL=":443" \
  -e WWW_USE_SSL="true" \
  -e CERT_FILE="/etc/ssl/certs/cert.pem" \
  -e KEY_FILE="/etc/ssl/certs/key.pem" \
  -e SUPABASE_URL="https://all-my-gear.pro" \
  -e SUPABASE_ANON_KEY="-" \
nichalterego/all-my-gear:latest
