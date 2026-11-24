# Handoff: rebuild Canvass Lead Finder in PHP and combine it with Pitch HQ

Paste this whole file into a new Claude Code session that has the `stalio10/Canvass` repository attached. Attach the Pitch HQ files as well.

---

## 1. Who the owner is and how to work with them

- The owner is **not a developer**. Use short, plain answers, give yes/no when asked, and leave out technical detail they didn't ask for.
- **Handle GitHub completely yourself**: commit, push, open and **merge** pull requests, and publish releases. The owner has explicitly authorised this and does not want to deal with merges, tags or GitHub settings.
- When the owner says "Q&A" or "don't build", answer only and change nothing.
- **Never ask the owner to paste API keys or passwords into chat.** They type secrets into the app's Settings themselves.
- Keep data honest: never invent companies, emails, phones, reviews, dates or scores. Missing data shows as *Not Available*, never as a problem. Every finding keeps its source and timestamp.

## 2. Goal

1. **Phase 1:** rebuild **Canvass Lead Finder** (currently Node.js) in **PHP 8.2 + MySQL** so it runs on the owner's Hostinger **Premium Web Hosting** plan (`hostinger_unlimited_v6`). That plan runs PHP only, not Node.js. Every feature of v1.0 must keep working. Deploy it, for example at `lead.mhdshibili.com`.
2. **Phase 2:** merge Lead Finder and **Canvass Pitch HQ** (`https://hq.mhdshibili.com`, PHP 8.2) into **one app with one login**.

Do Phase 1 completely, and live, before starting Phase 2. Each phase must end with something working.

## 3. Where things are now

- **Repository:** `github.com/stalio10/Canvass` (private). `main` holds **v1.0**.
- **Release v1.0.0** is published with `Canvass-Windows.zip`, a portable Windows build with Node.js included. Releases are produced by `.github/workflows/release.yml` when `main` changes and the `version` in `package.json` has no release yet. This environment **cannot push git tags**; the workflow creates the tag on GitHub's side.
- **Code layout (Node version, the reference to port):**
  - `server/lib/places.js`: Google Places API (New) client (Text Search with a field mask, Place Details, Maps link parsing).
  - `server/lib/verify.js`: age (RDAP, Internet Archive CDX, documented dates, dated reviews), activity, industry, location and size checks.
  - `server/lib/website-audit.js`: website audit plus PageSpeed. It includes an SSRF guard, offline detection and Cloudflare email decoding.
  - `server/lib/gbp-audit.js`: Google Business Profile audit and review analysis.
  - `server/lib/scoring.js`: the 4 validation categories, the 100-point score and service mapping.
  - `server/lib/pitch.js`: 5 pitch formats.
  - `server/lib/engine.js`: discovery (Module A), bulk upload (Module B), jobs, scheduler, legacy import.
  - `server/lib/db.js`: JSON store, backups, duplicate detection, 30-day Google purge, **free-tier budget guard**.
  - `server/index.js`: REST API (documented in `docs/API.md`).
  - `public/`: UI with 7 pages and a company card drawer. It can be reused almost as-is if the PHP API keeps the same routes and JSON shapes.
  - `test/`: 65 tests. **Port the test cases** as PHP tests or as an HTTP test suite against the PHP API. They define the required behaviour.
- **Docs to keep in sync:** `README.md`, `docs/SETUP.md`, `docs/API.md`, `docs/API-CONFIGURATION.md`, `docs/TEST-REPORT.md`, `docs/Canvass-User-Manual.pdf` (built from `docs/manual-src/manual.html` with Playwright), `docs/Canvass-Training.pptx` (python-pptx) and `docs/RELEASE-NOTES.md`.
- **Old app:** `legacy/` holds the first static app and its 102-business list (real contact data; do not publish it).

## 4. Rules that must stay exactly as in v1.0

- **Qualified** only if all of these pass: not a duplicate; currently operating (Google `OPERATIONAL` **plus** at least one recent-activity signal **plus** at least 2 signals in total); genuine (Google listing or team confirmation); relevant industry; within the selected location; small or growing (not over 1,000 reviews, not a chain of 3 or more same-name locations); age within **5 years**, rolling from today; public contact information; at least **one confirmed issue**.
- **Rejected:** older than the window, closed (permanently or temporarily), large or chain, out of location, irrelevant industry, invalid or fake, or duplicate.
- **Unverified:** any mandatory fact that can't be confirmed. **No Opportunity:** eligible but no confirmed issue.
- **Age:** only a documented licence or registration date (with a source) or a customer review older than the window counts as *Verified*. Domain (RDAP) and archive dates are *Estimated* only, unless the "Accept consistent estimates" setting is on. An old domain alone never rejects a company.
- A missing website link on Google is a *Potential Improvement*, never proof there is no website.
- **Our own network failure must never be reported as the business's problem.** Check connectivity first.
- The score (age 20, activity 25, Google Business 25, website 20, contact 10; High ≥80, Medium 60–79) **never overrides** a failed mandatory rule.
- Pitches are built only from real findings, include an opt-out line and make no guarantees. They are **never sent automatically**. Contact logging includes a 14-day repeat warning and do-not-contact.
- **Google Maps terms:** Google content is purged after 30 days (keep the Place ID); Google content is excluded from exports by default; Google-only contact details are removed after 30 days unless the team confirmed them.
- **Free-tier protection:** count every Places request per Pacific-Time month and day, refuse further requests beyond the limits **before sending**, and keep processing the companies already found. The owner's chosen limits are **900 a month and 50 a day**.
- API keys stay server-side, are masked in the UI and are never put in backups or in Git.

## 5. Making PHP shared hosting work

- **Long jobs** (discovery and bulk runs take minutes): store jobs in MySQL and process them in small batches, triggered by **cron every minute**. Optionally also continue from the browser while a page is open. Each batch must stay well under `max_execution_time`.
- **Scheduled searches, daily backups and the 30-day purge** run from the same cron script.
- **HTTP calls** use cURL with timeouts, retries on 429/5xx, the SSRF guard (block private IPs, resolve DNS first) and per-API throttling.
- **Storage:** MySQL (included in the plan). Use `hosting_databases_create` in the Hostinger connector. The app connects to `localhost`, never to the `srvNNNN.hstgr.io` host. Keep DB credentials in a config file on the server, outside Git.
- **Login is required** because it will be on the public internet: password hashing, sessions, a limit on login attempts, and a CSRF header (Pitch HQ already uses `X-Canvass: 1`). Re-use Pitch HQ's users in Phase 2.
- Excel import uses the existing client-side SheetJS (`public/vendor/xlsx.full.min.js`). CSV and XLSX export can stay client-side too.
- **Migration:** add an import of the v1.0 backup JSON (`Reports and Backup → Download backup`), so leads from the Windows version can move into the online version.

## 6. Hosting facts and blockers to resolve first

- The **Hostinger connector in the previous session was linked to an account that had no websites**. That account's only domain was `rarethoery.com` (plan `hostinger_unlimited_v6`, order 1010385863), and **mhdshibili.com was not in it**. The owner says `hq.mhdshibili.com` is on the same plan type. **First check which Hostinger account hosts mhdshibili.com**, and ask the owner to connect that account if needed.
- The owner will provide **all Pitch HQ files** (including `api.php`). Inspect them before designing Phase 2.
- **Google:** the owner has a Places API (New) key on a **Google Cloud free trial** ($300, 90 days; they must not click Upgrade). Google's per-day quotas show "Adjustable: No", so Canvass's own limits are the protection. The key only works with Maps Platform APIs, so PageSpeed needs a separate free key or the shared quota.

## 7. What's known about Pitch HQ (seen from its public page, v4.0)

- It is a single page app (`index.html`) with a PHP API at `api.php?a=<action>`. It sends the header `X-Canvass: 1` and a session cookie, and `GET api.php?a=me` returns `{"user":null,"version":"4.0"}` when signed out.
- **Actions:** `login {username,password}`, `logout`, `me`, `sync&rev=N` (returns `businesses`, `members`, `me`, `rev`, `same`), `biz_set {id,data}`, `biz_update {id,patch}`, `biz_delete {id}`, `claim`, `act_add {id,act}`, `act_delete`, `member_update`, `password`, `upload`, `admin_users`, `admin_user_save`.
- **Business fields:** `name, category, area, phone, website, instagram, address, services[], priority (hot|warm|cold), score, signals[], value (AED), status (lead|claimed|drafting|pitched|followup|won|lost), ownerId, helpers[], assets[], activities[], notes, google{rating,reviews,category,address,mapsUrl}, nextStep, nextDate, createdBy, createdAt, updatedAt, claimedAt, pitchedAt, wonAt, log[]`. IDs are `Date.now().toString(36)+random6`.
- **Categories:** Home services, Café, Restaurant, Salon & spa, Retail, Clinic, Gym & fitness, Real estate, Auto, Hospitality, Services, Other.
- **Services:** website, branding, social, seo, ads, photo, print, packaging.
- **Signals (points → service):** noweb 3 → website; oldweb 2 → website; fewrev 2 → seo; lowrate 2 → seo; noig 2 → social; fewpic 1 → photo; stale 1 → seo; noreply 1 → seo; noinfo 1 → seo. Priority: hot ≥7, warm ≥4, otherwise cold.
- HQ has its own manual "finder" (paste Google Maps text, optional AI parsing) and duplicate check (normalised name contains).
- **Suggested merge model:** Lead Finder validates. Qualified leads become HQ businesses with `status: lead`, Lead Finder's findings in `notes` and its signals mapped as above. HQ's claim → pitch → won workflow then replaces Lead Finder's simpler pipeline. Keep one user table, one login and one navigation.

## 8. Definition of done (Phase 1)

- Lead Finder is live on the owner's subdomain over HTTPS, behind a login, on the current plan.
- All v1.0 features work, and the ported tests pass.
- A real Google search for 3 leads has been run with the owner's key, with free-tier limits enforced.
- The v1.0 backup import works.
- Docs, manual and release notes are updated, and everything is committed, pushed and merged by you.
- The owner gets one short message: the link, and what to do next.
