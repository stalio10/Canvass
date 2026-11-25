# Canvass web API

All calls go to `api.php?a=<action>`. Responses are JSON. Errors are `{"error": "..."}` with an HTTP status.

- **Sign-in:** a session cookie (`canvass_t`, HttpOnly) from `login`. Everything except `me` and `login` needs it (401 otherwise).
- **Cross-site protection:** every `POST` must send the header `X-Canvass: 1` (400 otherwise).
- **Body:** `POST` actions take a JSON body. `GET` actions take query parameters.
- **Admin only:** marked (A). Others get 403.

## Pitch HQ

| Action | Method | Body / query | Returns |
|---|---|---|---|
| `me` | GET | | `{user, version}` (`user` is null when signed out) |
| `login` | POST | `{username, password}` | `{user}`; 10 wrong tries per IP per 15 min → 429 |
| `logout` | POST | | `{ok}` |
| `sync` | GET | `rev`, `acc=1` while Accounts is open | `{rev, me, businesses, members, rec, accHasPw, accUnlocked}`; `same:true` without businesses when `rev` matches. `rec` amounts are null unless Accounts is unlocked |
| `biz_set` | POST | `{id, data}` | create or restore a business |
| `biz_update` | POST | `{id, patch}` | owner, helpers or admin; helpers can't move stages; `lfId` can't be set by hand |
| `claim` | POST | `{id}` | first one wins; 409 `{taken:true}` otherwise |
| `act_add` / `act_delete` | POST | `{id, act}` / `{id, actId}` | activity and comments |
| `biz_delete` | POST | `{id}` | admin or creator |
| `member_update` | POST | `{colorIdx?, focus?, theme?, mentionsSeen?}` | |
| `password` | POST | `{current, new}` | change your own password |
| `upload` / `file` | POST form / GET `id` | | files up to 25 MB |
| `admin_users` / `admin_user_save` (A) | GET / POST | | team access |

## Accounts

Accounts need the accounts password. Unlocking marks the session open for 10 minutes (kept open while in use). Locked calls return **423**.

| Action | Method | Body | Notes |
|---|---|---|---|
| `acc_unlock` | POST | `{password}` | `{entries, rec, created}`. If no accounts password exists yet, the admin's first password (6+ characters) becomes it |
| `acc_lock` | POST | | |
| `acc_save` | POST | `{entry:{id,type,amount,date,cat,who,note}}` | `type`: capital, expense or income; amount > 0 |
| `acc_delete` | POST | `{id}` | |
| `rec_save` | POST | `{item:{id,name,amount,freq,next,remind,cat,who,notes}}` or `{item:{id,deleted:true}}` | recurring bills |
| `acc_setpw` (A) | POST | `{current, password}` | signs everyone else out of Accounts |

## Lead Finder

| Action | Method | Body / query | Returns |
|---|---|---|---|
| `lf_health` | GET | | keys present, demo mode, Google budget, background worker status, jobs waiting |
| `lf_settings` | GET | | settings with keys masked (`••••1234`) |
| `lf_settings_save` (A) | POST | settings patch | validated and clamped; masked values never overwrite a key |
| `lf_dashboard` | GET | | totals and chart data; pipeline numbers come from linked Canvass businesses |
| `lf_companies` | GET | `category` (Qualified, Unverified, Rejected, No Opportunity, all), `q`, `industry`, `priority`, `city`, `job`, `pipeline=1`, `sort` (score, recent, name), `page`, `size` | `{total, items}` summaries incl. `hq` (pipeline stage) |
| `lf_company` | GET | `id` | the full record with sources |
| `lf_company_patch` | POST | `{id, note?, doNotContact?, contactVerified?}` | |
| `lf_company_delete` (A) | POST | `{id}` | the pipeline card, if any, stays |
| `lf_evidence` | POST | `{id, type, source, date?, url?, label?}` | `type`: establishment, activity, identity, no-website, invalid; re-validated at once |
| `lf_contact_log` | POST | `{id, channel, force?}` | 409 within the cooldown (14 days) or for do-not-contact; moves the pipeline card to Pitched |
| `lf_to_pipeline` | POST | `{id, force?}` | 409 unless Qualified (send `force` to confirm); demo records refused |
| `lf_discover` | POST | `{country, city, area?, industryId, category?, count}` | job |
| `lf_bulk` | POST | `{rows?, text?, fileName, industryId?, city?, country?, quick?, linkHq?}` | job |
| `lf_bulk_legacy` | POST | | job for the v0 list, if present |
| `lf_refresh` | POST | `{ids}` | job (up to 500) |
| `lf_jobs` / `lf_job` | GET | `id` | job list / one job with its log |
| `lf_job_cancel` | POST | `{id}` | stops after the current business |
| `lf_tick` | POST | | does a few seconds of background work when no cron or worker is running |
| `lf_history` | GET | | searches and skipped duplicates |
| `lf_usage` | GET | | Google budget and daily request counts with estimated cost |
| `lf_export` | GET | `dataset`, `format=csv` | table, or a CSV download |
| `lf_backup_download` | GET | | backup JSON (v1.0 shape, no keys) |
| `lf_backup_save` / `lf_backups` | POST / GET | | server backups |
| `lf_backup_restore` (A) / `lf_restore` (A) | POST | `{name}` / backup JSON (v1.0 or 2.0) | `{restored, addedToPipeline}` |
| `lf_demo_load` / `lf_demo_clear` (A) | POST | | demo data on/off |
| `lf_schedules` / `lf_schedule_save` / `lf_schedule_delete` | GET / POST / POST | | repeating searches |

## Background worker

`php cron.php` works for about 50 seconds and stops (for a cron job every minute). `php cron.php --loop` keeps running (local use); `--watch=127.0.0.1:4400` makes it stop when the local server stops. Jobs are processed one step at a time (one Google page or one business), so no web request runs long.
