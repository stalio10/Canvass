# REST API reference

Base URL: `http://localhost:4321/api`. Everything is JSON.

- Requests other than `GET` must send the header `X-Requested-With: canvass`. This blocks cross-site form attacks.
- If the server was started with `CANVASS_PIN`, every request must send `X-Canvass-PIN: <pin>`.
- Errors return `{ "error": "message" }` with status 400 (bad input), 401 (PIN), 403, 404, 409 (conflict such as a repeat contact) or 500.

## System

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Version, whether keys are configured, demo mode |
| GET | `/settings` | All settings. Keys are masked (`googlePlacesKey: "••••1234"`, `googlePlacesKeyConfigured: true`) |
| PUT | `/settings` | Partial update. Numbers are clamped to safe ranges. Masked key values are ignored. `""` removes a key |
| GET | `/dashboard` | `totals` (14 counters) and `charts` (validation, industry, location, issues, services, pipeline, priority) |

## Lead discovery (both modules)

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/discover` | `{ country, city, area?, industryId, category?, count }` | Module A. Starts a Google discovery job. Returns the job |
| POST | `/bulk` | `{ rows?: string[][], text?: string, fileName?, industryId?, city?, country? }` | Module B. `rows` is a sheet (first row = headers); `text` is one URL, name or Maps link per line |
| POST | `/bulk/legacy` | none | Re-validates the 102 businesses in `legacy/analyzed-leads-data.js` |
| POST | `/refresh` | `{ ids: [] }` | Re-runs all checks for up to 500 companies |
| GET | `/jobs` | | Latest 50 jobs (without logs) |
| GET | `/jobs/:id` | | Job with `status` (queued, running, done, failed, cancelled), `progress`, `counts`, `log` |
| POST | `/jobs/:id/cancel` | | Stops after the companies in progress |

Recognised upload headers (case and punctuation ignored): Company / Business name, Website / URL / Domain, Phone, Email, Address, City / Emirate, Area, Country, Industry / Category, Google Maps link, Instagram, LinkedIn, Facebook, Established date / Licence issue date, Established source.

## Companies

| Method | Path | Description |
|---|---|---|
| GET | `/companies?category=&q=&industry=&priority=&city=&pipeline=1&sort=score\|recent\|name&page=&size=` | Summaries. `category` is Qualified, Unverified, Rejected, No Opportunity or all |
| GET | `/companies/:id` | Full record (see below) |
| PATCH | `/companies/:id` | `{ stage?, assignedTo?, followUpDate?, note?, doNotContact?, contactVerified? }`. Only qualified leads can enter the pipeline |
| POST | `/companies/:id/evidence` | `{ type: establishment\|activity\|identity\|no-website\|invalid, source (required), date?, url?, label? }`, then re-validates |
| POST | `/companies/:id/contact-log` | `{ channel: email\|whatsapp\|call\|proposal\|auditOffer, force? }`. Returns 409 if contacted on that channel within the cooldown, or if marked do-not-contact |
| POST | `/companies/:id/refresh` | Re-verify one company online |
| DELETE | `/companies/:id` | Delete |

### Company record (main fields)

```jsonc
{
  "id": "cmp_…", "name": "…", "industryId": "interior-design", "country": "…", "city": "…", "area": "…",
  "source": { "type": "google|bulk|legacy|demo|manual", "detail": "…", "searchId": "job_…" },
  "contact": { "phone", "email", "website", "address", "mapsUrl", "directionsUrl" },
  "contactSources": { "phone": "Google Places", "email": "Website: example.ae" },
  "google": { "placeId", "fetchedAt", "businessStatus", "rating", "userRatingCount", "reviews": [], "photoCount", "types": [], … },
  "websiteAudit": { "availability", "https", "page", "brokenLinks", "pagespeed", "issues": [] },
  "age": { "status": "Verified|Estimated|Unverified|Not Available", "withinWindow": true|false|null, "earliestDate", "evidence": [{ "label", "date", "source", "url", "checkedAt", "strength" }], "websiteAge": {} },
  "activity": { "status": "Verified|Unverified|Closed permanently|Closed temporarily", "evidence": [], "signals": 0 },
  "industryCheck", "locationCheck", "sizeCheck",
  "gbpAudit": { "issues": [], "notChecked": [] }, "reviewAnalysis": { "status", "positiveThemes", "negativeThemes", "repeatedComplaints", "confidence" },
  "issues": [{ "id", "area": "gbp|website", "status": "Confirmed Issue|Potential Improvement", "title", "detail", "services": [], "evidence", "checkedAt" }],
  "services": [{ "name", "group", "reasons": [] }],
  "validation": { "category", "reasons": [], "checks": [{ "id", "label", "state", "detail" }], "validatedAt" },
  "score": { "total": 0-100, "parts": {}, "priority": "High|Medium|Low" },
  "pitch": { "email", "whatsapp", "call", "proposal", "auditOffer", "generatedAt" } | null,
  "pipeline": { "inPipeline", "stage", "assignedTo", "followUpDate", "notes": [], "history": [], "contactLog": [], "doNotContact" },
  "lastVerifiedAt": "ISO date"
}
```

## Reports and backup

| Method | Path | Description |
|---|---|---|
| GET | `/export?dataset=qualified\|pipeline\|unverified\|rejected\|no-opportunity\|all` | `{ header, rows, note }` |
| GET | `/export?…&format=csv` | CSV download (UTF-8, Excel-compatible) |
| GET | `/history` | Search history and duplicates skipped |
| GET | `/usage` | Requests per API per day plus estimated cost |
| GET | `/backup` | Download a full backup (keys removed) |
| POST | `/backup` | Save a backup in `data/backups` |
| GET | `/backups` | List saved backups |
| POST | `/backups/:name/restore` | Restore a saved backup (a safety backup is taken first) |
| POST | `/restore` | Restore from an uploaded backup JSON |
| POST | `/demo/load` / `/demo/clear` | Load or remove the labelled demo companies (also switches demo mode) |
| GET / POST / DELETE | `/schedules`, `/schedules/:id` | Scheduled searches `{ name, everyHours (≥24), params: { country, city, area, industryId, category, count } }` |
