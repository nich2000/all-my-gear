#!/bin/bash

docker run \
  --name all-my-gear \
  -d --restart always \
  -p 4443:4443 \
  -v /root/cert.pem:/etc/ssl/certs/cert.pem:ro \
  -v /root/key.pem:/etc/ssl/certs/key.pem:ro \
  -e TZ=Europe/Moscow \
  -e WWW_DIR="/app/www/" \
  -e WWW_URL=":443" \
  -e CERT_FILE="/etc/ssl/certs/cert.pem" \
  -e KEY_FILE="/etc/ssl/certs/key.pem" \
  -e SUPABASE_URL="" \
  -e SUPABASE_ANON_KEY="" \
nichalterego/all-my-gear:latest
