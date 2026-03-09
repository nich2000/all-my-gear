#!/bin/bash

docker run \
  --platform linux/amd64 \
  --name all-my-gear \
  -d --restart always \
  -p 8080:8080 \
  -v /etc/letsencrypt/live/all-my-gear.pro/fullchain.pem:/etc/ssl/certs/cert.pem:ro \
  -v /etc/letsencrypt/live/all-my-gear.pro/privkey.pem:/etc/ssl/certs/key.pem:ro \
  -e TZ=Europe/Moscow \
  -e WWW_DIR="/app/www/" \
  -e WWW_URL=":8080" \
  -e WWW_USE_SSL="false" \
  -e CERT_FILE="/etc/ssl/certs/cert.pem" \
  -e KEY_FILE="/etc/ssl/certs/key.pem" \
  -e SUPABASE_URL="https://all-my-gear.pro" \
  -e SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzczMDYyNDMzLCJleHAiOjE5MzA3NDI0MzN9.US9XQ0jUYjwzaTisIHK0poFft4GA4sUwZKKE6NOWzKE" \
nichalterego/all-my-gear:latest
