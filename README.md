# Comet HQ — PHP v2

Comet HQ is a PHP sales workspace for discovering, auditing and managing local business website opportunities.

## v2 focus

- Telescope searches and automatic website opportunity checks
- Search/category and searched-by filters
- Persistent per-user result filters
- Qualified, Unverified, No Opportunity and Rejected classifications
- Pipeline assignment with clickable, visually muted assigned leads
- Trash with recoverable soft deletion
- SQLite data storage with backups and restore
- Hostinger-compatible PHP worker through `cron.php`

## Local run

The portable Windows launcher is kept in the private local project folder, not in this repository. Open the local Comet HQ folder and run **Start Canvass.bat**. The app uses the local `data` directory for its SQLite database.

## Hosting

Upload the PHP application files in this repository to the subdomain document root. Enable PHP extensions `pdo_sqlite`, `sqlite3`, `curl`, `openssl`, `mbstring` and `fileinfo`. Configure a cron job for `cron.php` once per minute. Do not commit the local database or API keys.

Use [HOSTINGER_HANDOFF.md](HOSTINGER_HANDOFF.md) for the migration, backup/restore and go-live checklist.

## Data and secrets

Business data and API keys are intentionally excluded from Git. Migrate the local data through **Telescope → Reports & backup → Download backup**, then restore it on the hosted installation and enter the API key again in Settings.

This v2 release does not modify the v1.0 tag.
