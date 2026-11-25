# Test report: Canvass 2.0

**Result: 75 of 75 automated tests pass** (`php canvass/tests/run.php`, PHP 8.3 locally; the code targets PHP 8.2 as on Hostinger).

The v1.0 test cases were ported to PHP and extended for the combined app.

| File | Tests | What it proves |
|---|---|---|
| `rules_test.php` | 25 | The mandatory rules decide the category and the score never overrides them; closed, old, large, out-of-area, irrelevant, duplicate and fake businesses are rejected; missing evidence gives Unverified; the 5-year window rolls with today's date; domain and archive dates alone are only estimates and never reject; activity needs Google "open" plus a recent signal plus 2 signals; services come only from findings |
| `audit_test.php` | 14 | Website facts are measured (including Cloudflare-hidden emails); a well-built site has no confirmed issues; PageSpeed scores are used only when the test ran; our own network failure is never reported as the business's problem; Google profile gaps and benchmarks; honest review analysis; pitches use real findings, include an opt-out and promise nothing |
| `budget_test.php` | 7 | Google Places requests stop at the monthly and daily limits **before sending**; failed requests count; other services are never blocked; a search that hits the limit keeps processing what it found; defaults are 900 a month and 50 a day |
| `engine_test.php` | 15 | Bulk parsing; duplicate detection by Place ID, domain, phone, name and area; Google discovery end to end with a mocked API; qualified leads become **Canvass pipeline cards** once, without Google ratings; automatic hand-off can be switched off; API failures stop cleanly with nothing fake stored; retries; SSRF guard; missing data stays Unverified; Quick add "check fully" links the report; 30-day Google purge also cleans the pipeline card; backups exclude keys; **v1.0 backups import** and their pipeline leads join the pipeline once |
| `http_test.php` | 14 | Against a real local server: sign-in required, login attempt limit, cross-site header; keys masked, clamped, admin-only and never in backups; demo data labelled and kept out of the pipeline; pipeline rules; 14-day contact warning and do-not-contact, with the card moving to Pitched; evidence re-validates; exports leave out Google content by default; v1.0 restore through the API; Accounts password, lock and hidden amounts; Pitch HQ claim race and permissions; code and data folders are never served |

## Other checks

- **Same results as v1.0.** The demo set was run through both engines. Categories, scores, issue IDs and recommended services are identical for all 10 companies.
- **Browser checks** (Chromium, desktop 1400 px, tablet 900 px, phone 390 px, light and dark): every Lead Finder page, the business report, the sidebar submenu (open and folded), a live bulk upload of real websites with progress, Quick add with "check fully", pipeline card → full report, Accounts unlock, and search (Ctrl+K). No script errors.
- **Local package:** `Canvass-Local.zip` was unzipped and started with the Mac/Linux script: sign-in, the background worker, the private `lib/` folder (403) and the `data` folder all checked. The Windows script could not be run here (no Windows machine); PHP for Windows is the official 8.2.36 build, checksum-verified.

## Not tested here

- A real Google Places search: needs the owner's key, typed into Settings by the owner.
- Hostinger: the connected Hostinger account has no websites; mhdshibili.com is on another account.
