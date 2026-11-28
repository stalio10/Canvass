# Comet HQ — Hostinger handoff

This is the PHP version of Comet HQ. GitHub and Hostinger were not changed by this work.

## What is ready locally

- Telescope results are grouped by industry/search category and can be filtered by the team member who ran the search.
- Review-count and website-opportunity filters remain available.
- Filters are saved per signed-in user on the server, with a browser fallback, so they survive refreshes and later logins.
- Assigned leads are visually muted but remain clickable so the team can open and review them.
- Deleting a result moves it to Telescope → Trash instead of permanently deleting it. Admins can restore it.
- Active dashboard totals, results, pipeline views and exports ignore trashed records.
- The existing SQLite data is still under this project’s data location. No GitHub upload was performed.

## Before handing it to the hosting person

1. In the local app, open **Telescope → Reports & backup → Download backup**.
2. Keep that downloaded JSON as the migration copy. It contains the businesses, pipeline links, search history and usage counters, but it intentionally does not contain API keys.
3. On Hostinger, create the subdomain and point its document root to the PHP application root. For this GitHub v2 release, that is the repository root containing `api.php`, `index.html`, `lib/` and `cron.php`.
4. Upload the PHP application files from this release root only. Do not upload local databases, backups, temporary test clones, a bundled local PHP runtime, or any file containing a secret.
5. Put the backup JSON somewhere temporary outside the public document root, sign in as the Comet HQ administrator, and use **Telescope → Reports & backup → Restore from file**.
6. Enter the Google Places API key again in **Telescope → Settings** on the hosted site. Keep the key restricted to the services and server origin actually used by the hosted app.
7. Change the seeded passwords immediately in **My space** and **Team**.

## Hostinger requirements

The selected PHP version must have these extensions enabled:

- `pdo_sqlite` and `sqlite3`
- `curl` and `openssl`
- `mbstring` and `fileinfo`

The `data` directory used by the app must be writable by PHP and must not be publicly downloadable. The included `.htaccess` blocks the app library, data, SQLite files, backups and configuration files. Keep HTTPS enabled.

## Background worker

Create a Hostinger cron job that runs once per minute. The hosting person should use the PHP binary path supplied by hPanel, for example:

```text
/usr/bin/php /home/USERNAME/domains/SUBDOMAIN/public_html/cron.php
```

If the host does not allow CLI cron execution, configure a protected web cron URL with `CANVASS_CRON_KEY` and call `cron.php?key=...` once per minute. Never place that key in the browser, GitHub, or a public document.

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
