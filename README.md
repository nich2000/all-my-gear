
# ALLMYGEAR — Personal Gear List

This is a simple static page to create and manage a gear list for trips.

Features:
- Add items with fields: category, name, brand, model, weight (g), price (₽).
- Edit and delete items.
- Search by name and filter by category.
- Save data to the browser's `localStorage`.
- Upload a small photo; images are automatically resized/compressed to keep storage reasonable.

How to run
1. Open `index.html` in your browser (double-click or use `open index.html` on macOS).

Notes
- Data is stored locally in your browser — clearing browser storage will remove the list.
- To export the raw JSON from the console: `localStorage.getItem('allmygear.items')`.

Files
- `index.html` — main page
- `styles.css` — styles
- `app.js` — application logic

If you want, I can add JSON import/export, a printable view, cloud sync, or switch to storing images externally.

nano /etc/ssh/sshd_config
Port 5678
systemctl restart ssh

ssh-copy-id -p 5678 root@37.230.113.213

ssh -p 5678 root@37.230.113.213
ssh -p 5678 root@all-my-gear.pro

apt update
apt upgrade

apt install fail2ban certbot git
sudo apt install rsyslog
apt install docker.io
https://docs.docker.com/engine/install/ubuntu/#install-using-the-repository

systemctl enable docker
systemctl start docker

https://supabase.com/docs/guides/self-hosting

git clone https://github.com/supabase/supabase
mkdir all-my-gear
cp -rf supabase/docker/* all-my-gear/
cp supabase/docker/.env.example all-my-gear/.env
cd all-my-gear
docker compose pull

sh ./utils/generate-keys.sh

docker compose up -d

docker pull nichalterego/all-my-gear:latest

apt install nginx

sudo nano /etc/nginx/sites-available/all-my-gear

```
server {
    listen 80;
    server_name all-my-gear.pro;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    http2 on;  # <-- Новое место для http2
    server_name all-my-gear.pro;

    # Пути к сертификатам
    ssl_certificate /etc/letsencrypt/live/all-my-gear.pro/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/all-my-gear.pro/privkey.pem;

    # Безопасность SSL
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;

    # Прокси общие заголовки
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Проксирование всего на основной Go-сервер (порт 8080)
    location / {
        proxy_pass http://127.0.0.1:8080;
    }

    # Проксирование аутентификации на отдельный Go-сервер (порт 8000)
    location /auth {
        proxy_pass http://127.0.0.1:8000;
    }
}
```

sudo ln -s /etc/nginx/sites-available/all-my-gear /etc/nginx/sites-enabled/

sudo rm /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl reload nginx
или
sudo systemctl restart nginx


https://arenda-server.cloud/blog/kak-ustanovit-i-nastroit-postfix-na-ubuntu-24-04/

sudo nano /etc/postfix/sasl_passwd

sudo postmap /etc/postfix/sasl_passwd

sudo chmod 600 /etc/postfix/sasl_passwd*

echo "Test mail from postfix" | mail -s "Test Postfix" nich2000@mail.ru

mailq
