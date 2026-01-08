openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Org/CN=82.146.35.60"

#sudo certbot certonly -d all-my-gear.pro -d www.all-my-gear.pro
