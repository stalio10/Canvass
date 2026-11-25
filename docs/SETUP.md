# Setting up Canvass

Canvass is a PHP 8.2 app with an SQLite database. It needs no other software on the server.

## Try it on your computer

1. Download **Canvass-Local.zip** and unzip it anywhere (for example your Desktop).
2. **Windows:** double-click **Start Canvass.bat**.
   - If Windows says "Windows protected your PC", click **More info → Run anyway**.
   - If it says a Microsoft component is missing, install the free [Visual C++ Redistributable (x64)](https://aka.ms/vs/17/release/vc_redist.x64.exe) and try again.
   - If Windows Firewall asks about php.exe, you can click Cancel: Canvass only listens on this computer.
3. **Mac:** install PHP once (`brew install php` after installing [Homebrew](https://brew.sh)), then double-click **Start Canvass (Mac).command**.
4. Your browser opens <http://localhost:4400>. Sign in with **MSB / admin**. The Pitch HQ team accounts are created too (Ismail, Amal, Tins, password `0000`).
5. Keep the black window open while you use Canvass. On Windows a second, minimised window runs Lead Finder searches in the background; it closes by itself when Canvass stops.

Your data lives in the `data` folder next to the app. This copy is separate from the live Pitch HQ site.

## First steps

1. **Lead Finder → Settings** (admin): paste your Google Places API key ([how to get one](API-CONFIGURATION.md)), check *Your company*, and save.
2. **Lead Finder → Find on Google:** a small test, for example Interior design in Dubai, 3 leads.
3. Qualified leads appear in **Pipeline** under *Spotted*.
4. Moving leads from the Windows version (v1.0): in the old app use **Reports and Backup → Download backup**. In Canvass use **Lead Finder → Reports & backup → Restore from file**.

## Put it online (Hostinger)

These steps are for the Hostinger **Premium Web Hosting** plan (PHP only).

1. **Choose the address.** For example `app.mhdshibili.com`, or upgrade `hq.mhdshibili.com` in place.
2. **PHP version:** hPanel → *Advanced → PHP Configuration* → **PHP 8.2** for that website.
3. **Upload** the contents of the repository's `canvass/` folder into the site's folder (for a subdomain, usually `public_html/<subdomain>`). Leave out `canvass/tests/`.
4. **Data folder.** Canvass keeps its database outside the website folder when it can: `domains/<domain>/canvass-hq-data/`. That is the **same folder Pitch HQ uses**, so:
   - Upgrading `hq.mhdshibili.com` in place keeps every business, person and file; Canvass only adds new tables.
   - For a separate test site on the same domain, give it its own folder: create `config.php` next to `api.php` containing
     `<?php return ['dataDir' => '/home/<user>/domains/<domain>/canvass-test-data'];`
     (the website and the cron job both read it; it is never served).
   - Make a copy of `canvass-hq-data` before the first upgrade.
5. **Cron job:** hPanel → *Advanced → Cron Jobs* → every minute (`* * * * *`):
   `/usr/bin/php /home/<user>/domains/<domain>/public_html/<subdomain>/cron.php`
   This runs searches, scheduled searches, daily backups and the 30-day Google clean-up. Without it, searches still run while someone keeps a Canvass tab open.
6. **HTTPS:** hPanel → *Security → SSL* for the subdomain. Canvass redirects plain http to https.
7. Sign in as the admin, then **change the default passwords** (My space, and Team → Team access).
8. Add the Google key in **Lead Finder → Settings**, and run a 3-lead test search.

### Updating later

Replace the app files. Never delete the data folder. Settings, keys and data are in the database, not in the files.

## Where things are kept

| What | Where |
|---|---|
| Businesses, people, Accounts, Lead Finder results, settings and keys | `canvass.sqlite` in the data folder |
| Uploaded files (assets) | `files/` in the data folder |
| Daily Lead Finder backups (last 14) | `backups/` in the data folder |

## Troubleshooting

| Problem | What to do |
|---|---|
| "Searching Google needs a Google Places API key" | Add the key in Lead Finder → Settings (admin only) |
| A search sits at "Waiting" | No cron job and no open tab. Keep a tab open, or add the cron job |
| "Monthly / Daily Google Places limit reached" | Working as designed. Wait for the reset, or raise the limit in Settings |
| "PageSpeed: Failed – quota exceeded" | Add a free PageSpeed key. No scores are ever estimated |
| Website shows "Not checked: the Canvass server could not reach the internet" | The server's own connection failed. The business is not marked as having a problem |
| Accounts says it isn't set up | The admin opens Accounts once and chooses the accounts password |
