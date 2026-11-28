# Comet HQ — Hostinger handoff

This is the PHP version of Comet HQ. GitHub and Hostinger were not changed by this work.

## What is ready locally

- Telescope results are grouped by industry/search category and can be filtered by the team member who ran the search.
- Review-count and website-opportunity filters remain available.
- Filters are saved per signed-in user on the server, with a browser fallback, so they survive refreshes and later logins.
- Assigned leads are visually muted but remain clickable so the team can open and review them.
- Deleting a result moves it to Telescope → Trash instead of permanently deleting it. Admins can restore it.
- Active dashboard totals, results, pipeline views and exports ignore trashed records.

## Where things go on Hostinger (exact)

Comet HQ gets its **own** data. It never uses Pitch HQ's live database (`canvass-hq-data`).

| What | Path |
|---|---|
| Website files (upload here) | `/home/USER/domains/mhdshibili.com/public_html/SUBDOMAIN/` |
| Data (database, uploads, backups) | `/home/USER/domains/mhdshibili.com/comet-hq-data/` (outside `public_html`, never reachable from the web) |
| Server settings file | `/home/USER/domains/mhdshibili.com/public_html/SUBDOMAIN/config.php` (blocked from the web, never in Git) |

Replace `USER` with the Hostinger username shown in hPanel and `SUBDOMAIN` with the subdomain folder name (for example `comet`).

## Step by step

1. **Back up Pitch HQ first.** In hPanel File Manager, download a copy of `/home/USER/domains/mhdshibili.com/canvass-hq-data/`. Comet HQ won't touch it; this is a safety copy.
2. **Create the subdomain** in hPanel (*Domains → Subdomains*), for example `comet.mhdshibili.com`, with document root `public_html/SUBDOMAIN`.
3. **PHP version:** hPanel → *Advanced → PHP Configuration* → PHP 8.2 or newer, with `pdo_sqlite`, `sqlite3`, `curl`, `openssl`, `mbstring` and `fileinfo` switched on.
4. **Upload** the contents of this release (the folder with `api.php`, `index.html`, `cron.php`, `lib/`, `vendor/`) into `public_html/SUBDOMAIN/`. Do **not** upload `tests/`, any `data/` or `backups/` folder, any `.sqlite` file, a PHP runtime, or anything containing an API key.
5. **Create `config.php`** in `public_html/SUBDOMAIN/` with exactly:
   ```php
   <?php return ['dataDir' => '/home/USER/domains/mhdshibili.com/comet-hq-data', 'hosted' => true];
   ```
   `dataDir` keeps the data outside `public_html`. `'hosted' => true` is the same as `CANVASS_HOSTED=1`: it switches off the local-testing sign-in shortcut for good on this server. (Without `config.php` the app still uses `comet-hq-data` two folders above the website by default, but write the file anyway so the setting is explicit.)
6. **Cron job:** hPanel → *Advanced → Cron Jobs* → *Custom*, every minute (`* * * * *`):
   ```text
   /usr/bin/php /home/USER/domains/mhdshibili.com/public_html/SUBDOMAIN/cron.php
   ```
   Use the PHP path hPanel shows if it differs. This runs Telescope searches, scheduled searches, daily backups and the 30-day Google clean-up.
7. **HTTPS:** hPanel → *Security → SSL* → install for the subdomain. The app redirects plain http to https.
8. **First sign-in and passwords** (do this immediately):
   - Open `https://SUBDOMAIN.mhdshibili.com` and sign in as `MSB` / `admin`.
   - Comet HQ **forces** a new password at the first sign-in of every seeded account (`MSB/admin`, `Ismail`, `Amal`, `Tins` with `0000`). Nothing else works until it is changed. Minimum 3 characters.
   - Then go to **Team → Team access**. For each person, either set a new temporary password with **Edit** (they must change it at their next sign-in) or switch off **Can sign in** for anyone who doesn't need access yet.
   - Passwords are stored as hashes only. Nobody, including the admin, can view them; the admin can only reset them.
9. **Bring your data across:** on the local copy, *Telescope → Reports & backup → Download backup*. On the hosted site, sign in as the admin and use *Restore from file*. Keep the backup file off the public website.
10. **Google key:** enter it again in *Telescope → Settings* (it is never in backups). Keep free-tier protection on.

## Security notes

- Local testing access (automatic admin sign-in) is **off by default**, only ever works for a request from the same computer (`127.0.0.1`), and is permanently disabled when `CANVASS_HOSTED=1` or `'hosted' => true` is set.
- The login limit (10 wrong tries per 15 minutes) uses the real connecting address only; faked `CF-Connecting-IP` / `X-Forwarded-For` headers are ignored.
- `.htaccess` blocks `lib/`, `data/`, `tests/`, `config.php`, `router.php`, database, backup and Markdown files. The data folder itself is outside `public_html`.

## Final checks before going live

- Sign in from two separate team accounts.
- Run one small Google search and confirm the worker completes it.
- Confirm a result shows its industry/search category and searcher filter.
- Assign one result, refresh, and confirm it is muted but still opens.
- Move one result to Trash and restore it.
- Confirm the dashboard, pipeline and reports show the migrated data.
- Confirm the API key is saved and a test search succeeds.
- Do not replace the existing GitHub v1.0 branch until the hosted copy has been tested and the owner explicitly approves that upload.

## Important data note

The backup/restore route is the supported migration method. It carries the data forward without copying the local machine’s API secrets. Do not copy the raw SQLite file while the app is running unless the hosting person understands SQLite WAL files and has stopped all workers first.
