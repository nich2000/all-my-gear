
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

ssh-copy-id -p 5678 root@37.230.113.213

ssh -p 5678 root@37.230.113.213
ssh -p 5678 root@all-my-gear.pro

apt update
apt upgrade

apt install fail2ban certbot
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
