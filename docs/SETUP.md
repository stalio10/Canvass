# Setup and installation guide

## Requirements

- A Windows 10/11, macOS or Linux computer with internet access.
- **Node.js 20 or newer (LTS)**. Download it from <https://nodejs.org>. Accept the defaults during installation.
- For automatic discovery, a Google Cloud project with **Places API (New)** enabled and billing turned on. See [API-CONFIGURATION.md](API-CONFIGURATION.md).

No database server and no `npm install` are needed.

## Install on Windows

1. Download the project from GitHub (**Code → Download ZIP**) and unzip it, for example to `C:\Canvass`.
2. Install Node.js LTS if you haven't already.
3. Double-click **`start-canvass.bat`**.
   - A black window opens. Keep it open while you use Canvass.
   - Your browser opens <http://localhost:4321>.
4. To stop Canvass, close the black window.

*Optional:* to start with one click, right-click `start-canvass.bat` → **Send to → Desktop (create shortcut)**.

## Install on macOS / Linux

```bash
cd Canvass
./start-canvass.sh
```

## First-time configuration

1. Open **Settings**.
2. Paste your **Google Places API key**. Optionally add a **PageSpeed Insights key** (free; strongly recommended because the shared free quota runs out).
3. Fill in **Your company** (the name, sender, phone and email used in pitches).
4. Enter your **Team members**.
5. Review **Lead eligibility**. The defaults follow the Canvass brief: a 5-year window, documented age required, and at least one confirmed issue.
6. Click **Save settings**.

To explore without keys, click **Load demo data** in Settings. Demo companies are fictional and marked **[DEMO]**. Remove them before real use.

## Using it on phones, tablets or other PCs (same Wi-Fi)

1. Run **`start-canvass-network.bat`** on the main PC and choose an access PIN.
2. Allow Node.js through Windows Firewall on **Private networks** only.
3. Find the PC's IP address: open Command Prompt and run `ipconfig`, then look for the *IPv4 Address*, such as `192.168.1.20`.
4. On the phone, open `http://192.168.1.20:4321` and enter the PIN.
5. Android Chrome: menu → **Add to Home screen**. Full app installation needs HTTPS, so over plain Wi-Fi it opens as a browser shortcut.

All devices share the database on the main PC. That PC must be on while others use Canvass.

## Where your data lives

- `data/canvass-db.json` is the database.
- `data/backups/` holds the automatic daily backups (last 14 kept) and manual backups.
- To move Canvass to another PC, copy the whole folder, including `data/`. You can also download a backup in **Reports and Backup** and restore it on the new PC. API keys are not included in backups, so re-enter them there.

## Environment variables (optional)

| Variable | Purpose |
|---|---|
| `GOOGLE_PLACES_API_KEY` | Places key (overrides Settings) |
| `PAGESPEED_API_KEY` | PageSpeed key (overrides Settings) |
| `PORT` | Default `4321` |
| `HOST` | `127.0.0.1` (this PC only) or `0.0.0.0` (network) |
| `CANVASS_PIN` | PIN required for API access, recommended with `HOST=0.0.0.0` |
| `CANVASS_DATA_DIR` | Store data somewhere other than `./data` |
| `NODE_USE_ENV_PROXY=1` | Use the system `HTTPS_PROXY` (office networks). Already set by the launchers |

## Updating

Replace every file **except the `data/` folder**, then restart.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Node.js is not installed" | Install Node.js LTS, then reopen the launcher |
| Browser shows "can't connect" | The black window was closed. Run the launcher again |
| "Google Places: API key not valid" / 403 | Enable **Places API (New)** for the key's project and check the key's restrictions |
| "PageSpeed: Quota exceeded" | Add a PageSpeed API key in Settings |
| Websites show "Not checked: this computer could not reach the internet" | Check your connection. Canvass never blames the business for your network problem |
| Port 4321 already in use | Set `PORT=4322` before starting, or close the other copy |
