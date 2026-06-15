# 📦 Telegram Unzip Bot

Bot Telegram untuk mengekstrak arsip `.zip` dan `.7z` secara otomatis dengan dukungan file besar (>2GB) via MTProto.

---

## ✨ Fitur

| Fitur | Keterangan |
|---|---|
| Format | `.zip` dan `.7z` |
| File Besar | MTProto otomatis untuk file >2GB |
| Keamanan | Hanya OWNER_ID yang bisa pakai |
| Password | Maks 5 percobaan, cooldown 10 detik |
| Auto Cleanup | Temp folder dibersihkan setiap 3 jam |
| Progress | Update real-time download & ekstrak |
| Logging | File log harian + console |
| Docker | Deploy satu perintah dengan persistent volume |

---

## 🚀 Deploy Cepat

### 1. Clone / salin project

```bash
git clone <repo-url> telegram-unzip-bot
cd telegram-unzip-bot
```

### 2. Konfigurasi `.env`

```bash
cp .env.example .env
nano .env
```

Isi nilai berikut:

```env
BOT_TOKEN=          # Token dari @BotFather
API_ID=             # Dari https://my.telegram.org/apps
API_HASH=           # Dari https://my.telegram.org/apps
OWNER_ID=           # User ID Telegram kamu (dari @userinfobot)
ARCHIVE_PASSWORD=   # Password untuk ekstrak arsip
```

### 3. Buat direktori & assets

```bash
mkdir -p downloads temp logs data assets
# Opsional: tambahkan assets/menu.jpg dan assets/success.jpg
```

### 4. Deploy

```bash
docker compose up -d --build
```

### 5. Cek status

```bash
docker compose ps
docker compose logs -f
```

---

## 📁 Struktur Project

```
telegram-unzip-bot/
├── src/
│   ├── index.js        # Entry point & graceful shutdown
│   ├── config.js       # Konfigurasi dari .env
│   ├── handlers.js     # Command & message handlers
│   ├── downloader.js   # Download via Bot API & MTProto
│   ├── extractor.js    # Ekstrak ZIP & 7Z + path traversal guard
│   ├── uploader.js     # Kirim file hasil ekstrak
│   ├── session.js      # State per-user (password, cooldown)
│   ├── cleanup.js      # Auto-cleanup + scheduler
│   ├── stats.js        # Statistik persistent
│   ├── logger.js       # Winston logger (file + console)
│   └── health.js       # Docker health check script
├── assets/
│   ├── menu.jpg        # (opsional) Gambar untuk /start
│   └── success.jpg     # (opsional) Gambar sukses ekstrak
├── downloads/          # File arsip yang diunduh (volume)
├── temp/               # Workspace ekstraksi (volume)
├── logs/               # File log harian (volume)
├── data/               # Stats, session MTProto (volume)
├── .env                # Konfigurasi (JANGAN di-commit!)
├── .env.example        # Template konfigurasi
├── Dockerfile          # Multi-stage build
├── docker-compose.yml  # Compose dengan persistent volumes
└── package.json
```

---

## 🤖 Commands

| Command | Fungsi |
|---|---|
| `/start` | Menu utama + gambar |
| `/help` | Panduan penggunaan |
| `/stats` | Statistik & uptime bot |
| `/cancel` | Batalkan proses aktif |
| `/skip` | Lewati password (arsip tanpa enkripsi) |

---

## 📋 Cara Pakai

1. Kirim file `.zip` atau `.7z` ke bot
2. Bot meminta password
3. Ketik password atau `/skip` jika tidak ada
4. Bot mengunduh → ekstrak → kirim semua file hasil

---

## 🔐 Keamanan

- Hanya `OWNER_ID` yang dapat menggunakan bot
- Maks 5 percobaan password, lalu cooldown 10 detik
- Path traversal protection saat ekstraksi
- Sanitasi nama file dari karakter berbahaya
- Container berjalan sebagai non-root user

---

## ⚙️ Environment Variables

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `BOT_TOKEN` | ✅ | — | Token dari @BotFather |
| `API_ID` | ✅ | — | MTProto API ID |
| `API_HASH` | ✅ | — | MTProto API Hash |
| `OWNER_ID` | ✅ | — | Telegram User ID owner |
| `ARCHIVE_PASSWORD` | — | `""` | Password arsip default |
| `MAX_PASSWORD_ATTEMPTS` | — | `5` | Maks percobaan password |
| `COOLDOWN_SECONDS` | — | `10` | Durasi cooldown (detik) |
| `CLEANUP_INTERVAL_HOURS` | — | `3` | Interval auto-cleanup (jam) |
| `LOG_LEVEL` | — | `info` | Level log: error/warn/info/debug |

---

## 🐳 Docker Commands

```bash
# Start
docker compose up -d --build

# Stop
docker compose down

# Restart
docker compose restart bot

# Lihat log live
docker compose logs -f bot

# Masuk container
docker compose exec bot sh

# Cek health
docker compose ps
docker inspect telegram-unzip-bot --format '{{.State.Health.Status}}'

# Cleanup manual
docker compose exec bot node -e "require('./src/cleanup').runCleanup(true)"
```

---

## 📊 Monitoring

Bot menulis file health ke `/data/data/health.json` setiap 30 detik. Docker secara otomatis memeriksa file ini setiap 30 detik.

Log disimpan di `./logs/` dengan rotasi harian:
- `bot-YYYY-MM-DD.log` — semua log
- `error-YYYY-MM-DD.log` — hanya error

---

## 🛠️ Development

```bash
# Install deps
npm install

# Jalankan dengan auto-reload
npm run dev

# Jalankan production
npm start
```

---

## 📦 Dependencies

- **telegraf** — Telegram Bot Framework
- **telegram** (GramJS) — MTProto client untuk file >2GB
- **adm-zip** — Ekstrak ZIP
- **node-7z** — Ekstrak 7Z (wrapper 7za binary)
- **winston** — Logging
- **node-schedule** — Scheduler cleanup
- **fs-extra** — File system utilities

---

## ⚠️ Catatan

- File `assets/menu.jpg` dan `assets/success.jpg` opsional. Jika tidak ada, bot fallback ke teks.
- MTProto session disimpan di `data/session.txt` — jaga kerahasiaannya.
- Pastikan `API_ID` dan `API_HASH` valid dari [my.telegram.org](https://my.telegram.org/apps).
- Untuk file sangat besar (>10GB), pastikan volume `temp` dan `downloads` memiliki ruang cukup.
