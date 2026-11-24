# Canvass ERP — Complete Project Handoff

Last updated: 22 November 2026 (Asia/Dubai)
Workspace: `C:\Users\USER\Desktop\smaple -vsc`

This file is the handoff for the next AI agent or developer. Read it before changing data, running analysis, or editing the ERP. It records the user's requirements, the current implementation, what the data means, what remains incomplete, and which files are reference material only.

## 1. User's goal and operating instructions

The user is building a small Canvass lead-management ERP for a four-person team. The main workflow is:

1. The user chooses and uploads a curated Excel or CSV file containing business website links.
2. The ERP analyzes only the businesses in that upload and presents the results on a dashboard.
3. Businesses are automatically classified as Good, Medium, Bad, or Needs review, with filters to select useful records.
4. Team members can track pipeline stage, owner, follow-up date, and notes.
5. The user can export useful reports, including an Excel workbook with multiple report sheets.
6. The user previously requested Google Sheets/Drive and team logins, but those are not connected yet.

Important user instructions from the conversation:

- Do not analyze unrelated bulk/prospect files. The user will provide a curated Excel/CSV list and wants analysis limited to those uploads.
- Do not make website status a manual dropdown. Website grade should be derived from analysis and displayed as read-only status.
- The user's requested business data headers are:

  `SL No | Company | Industry | Address | Phone | Email | Google Rating | All Google Reviews | Review Count | Website URL | Website Status | Instagram URL | Latest Review Date | LinkedIn URL | Source`

- The user requested that dashboard filters update the visible records and that exports include the data.
- Four team members need to be able to see/update shared data eventually.
- Google review quality should account for rating, review count, recency, and owner replies when those facts are actually obtained.
- The user wants a code deliverable and asked for a full README handoff.

When adding new features, keep the interface simple and usable. Do not represent data that has not actually been fetched as if it had been verified.

## 2. Current state at handoff

### Curated analysis

- `website-full-analysis.csv` contains **102 unique businesses/domains**.
- All 102 have `PageSpeed Audit Status = Checked`.
- Current website grade counts: **Good 14, Medium 61, Bad 27**. There are no `Needs review` rows in this curated export.
- The 102 records have mobile PageSpeed/Lighthouse results and website/SEO details assembled from the website audit output.
- Google Rating, All Google Reviews, Review Count, Latest Review Date are still `Not checked` or empty. Therefore this is a completed website/PageSpeed dataset, **not** a complete Google Business/Google review analysis.
- No Google review vote/reply sentiment has been computed. The UI can calculate Google review points only after source fields are populated.
- LinkedIn and Instagram columns contain values only where found in the supplied data/source analysis; their presence is not independently verified by the PageSpeed audit.

### Removal of the accidental large list

- A browser-storage migration was added to `index.html`. On the first load of this version, it replaces the old `uaeLeadFinder.v1` localStorage lead list with the curated seed from `analyzed-leads-data.js` (102 records).
- The migration marker is `uaeLeadFinder.v1.curated102-v1`.
- For domains that overlap with the old browser list, it preserves prior `id`, pipeline stage, assigned member, follow-up date, review note, and checked date when available.
- Once the marker is set to `done`, the migration will not run again automatically. If an old list still shows, check the browser origin, whether this exact app version was loaded, and the marker/localStorage. Do not clear all browser storage without first considering the user's workflow data.
- The migration only affects ERP browser localStorage when the updated app is opened. It does not delete source workbooks or historical audit output files.
- New Excel/CSV imports are deduplicated against saved businesses by normalized website domain and append new unique businesses. They do **not** currently replace the entire list on every subsequent upload. Confirm/implement replacement semantics only if needed; the user's intended boundary is that only their explicitly uploaded curated data is analyzed.

### Source workbook / prior input

- The earlier uploaded input was `C:\Users\USER\Desktop\web.xlsx` (outside the workspace file listing). Prior inspection found 138 website URL rows and 125 unique domains. The original workbook was intentionally left unchanged.
- Do not assume that `web.xlsx` is present in this workspace or analyze another workbook just because it exists here. Ask the user to upload their next curated file in the current workflow, then use only that upload for new website analysis.

## 3. Workspace file map

### Active ERP and deliverables

- `index.html` — single-page Canvass ERP UI and client-side application logic. Dashboard, lead/business tables, filters, imports/exports, pipeline/team workflow, lead finder UI, localStorage persistence, and the one-time curated-data migration live here.
- `website-audit.js` — browser-side Google PageSpeed Insights integration, audit progress display, auto-analysis after adding new unique domains, Lighthouse fields/columns, import de-duplication and business-type UI enhancements.
- `analyzed-leads-data.js` — embeds the 102 curated analyzed records as `window.CANVASS_ANALYZED_LEADS`; loaded by `index.html`. Required for the first-load migration and initial seeded list.
- `website-full-analysis.csv` — current filtered, 102-row, fully PageSpeed-checked report. This is the current analysis deliverable.
- `Canvass-ERP-source-20261122.zip` — latest source package, created 22 November 2026; includes `index.html`, `website-audit.js`, `analyzed-leads-data.js`, `supabase-setup.sql`, and `SUPABASE_SETUP.md`.
- `Canvass-ERP-source-20261121.zip` — older source package; do not use in preference to the 22 November package.
- `supabase-setup.sql` and `SUPABASE_SETUP.md` — Supabase schema/RLS setup scaffold and setup notes. This is not proof that the running app is connected to Supabase.

### Other files that exist but are not the active curated ERP list

The workspace also contains large or historical files, including:

- `UAE_ICV_Companies_8821_Clickable.xlsx`
- `UAE_ICV_Companies_8822_Prospect_Master.csv`
- `D-S.xlsx`
- `DZL Inventory Sheet 18-09-2026.xlsx`
- Historical `website-audit-results-*.csv` files
- Historical directories named `website-audit-parts-*`, `website-audit-resume-*`, `website-content-parts-*`, and `pagespeed-retry-*`
- `website-content-analysis-20261121-232109.csv`

These files are legacy/source/reference artifacts and may contain thousands of prospects or incomplete/duplicate audit attempts. **Do not import them into the ERP, merge them into the 102 records, or run website analysis against them.** Do not delete them unless the user explicitly asks; the cleanup performed here was to restrict the ERP's active list and current report, not purge unrelated source/history files. The next analyzed businesses must come from the user's explicit curated upload.

## 4. Website analysis and grade rules

The browser analysis in `website-audit.js` calls the Google PageSpeed Insights v5 endpoint using `strategy=mobile`, requesting Lighthouse categories:

- Performance
- SEO
- Accessibility
- Best Practices

The category scores are integers from 0 to 100. Current grade function:

- **Bad** if any available category score is below 50.
- **Medium** if no score is below 50, but one or more categories is below 80, or fewer than all four categories are present.
- **Good** if all four category scores are present and each is at least 80.
- **Needs review / unknown** when there are no usable scores or the site cannot be classified.

The script also derives checks for mobile viewport, HTTPS, page title, and meta description from Lighthouse audits. The existing combined report contains additional basic on-page checks, including HTTP reachability, final URL, title, description, Open Graph title, H1 count/first H1, canonical URL, and a basic SEO score. These checks are not equivalent to an exhaustive crawl of every page on a site. PageSpeed results are mobile homepage/URL Lighthouse audits, not a full technical crawl or a guarantee of business quality.

The app's basic business opportunity points (when source fields exist) currently follow this logic in `index.html`:

- Missing website: +3.
- Existing site marked old/broken/not mobile: +2.
- Fewer than 20 reviews: +2.
- Google rating below 4.0: +2.
- Instagram inactive or absent: +2.
- Fewer than 10 photos or photos marked poor: +1.
- No review in the past 90 days: +1.
- Owner never replies to reviews: +1.
- Missing phone or business hours: +1.
- Total is capped at 15.

Google review points are calculated only from data present in the lead record: review count under 20 (+2), rating under 4.0 (+2), latest review older than 90 days (+1), and owner reply status `no`/`never`/`none` (+1). If no usable Google facts exist, the UI should say `Not checked`; it must not invent a score or review sentiment. At present, none of the 102 sites have Google rating/review-count values checked.

## 5. Current app behavior and limits

- The ERP is a static, single-page HTML/JavaScript app; there is no build system or server required for the basic localStorage version.
- `index.html` loads `analyzed-leads-data.js`, the SheetJS library from `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`, then `website-audit.js`.
- Excel import/export depends on internet access to load SheetJS. CSV import/export is the fallback when SheetJS is unavailable.
- Website PageSpeed analysis requires internet access and is subject to Google API quotas/rate limits. Audit results save as each site finishes; quota failure may leave some rows needing retry.
- When new unique domains are imported, the auto-analysis wrapper starts the audit flow. The audit flow can prompt for a PageSpeed API key; it saves a supplied key in this browser's localStorage (`uaeLeadFinder.v1.pagespeedKey`). A previously supplied key is deliberately **not** included in this README, source package, or response. Do not hard-code API keys in source. The key was exposed in a conversation and should be rotated/restricted by its owner before reuse.
- The Lead Finder opens Google Maps searches in a new tab. It is a convenience for a human to inspect listings, **not** a Google Maps scraper and does not automatically retrieve Places ratings/reviews.
- LinkedIn URLs are not automatically searched/fetched live by PageSpeed. The current app does not perform automatic LinkedIn company discovery.
- Google Sheets/Drive sync is not implemented. Exports download local CSV/XLSX files.
- Although Supabase SQL and setup notes exist, `index.html` currently uses browser localStorage (`uaeLeadFinder.v1`) and does not implement Supabase authentication/shared database sync. Thus it is not yet a live multi-device shared ERP and does not yet provide real username/password login. Do not tell the user Supabase login or cloud sync is active.
- Four member labels can be configured in browser storage, but they are not authenticated accounts and localStorage is not shared across the four members/devices.
- No test suite was run during this cleanup. Avoid claiming this handoff or app was tested in a browser unless that is actually done later.

## 6. Import/export data fields

The user's base import/export columns are listed in section 1. The enriched analysis report also contains these fields where available:

- Website Status Basis, Business Type, HTTP Status, Final URL
- Basic SEO Score and its basis
- PageSpeed Performance, PageSpeed SEO Score, Accessibility Score, Best Practices Score
- Mobile Viewport, HTTPS, Website Title, Meta Description, Open Graph Title
- H1 Count, First H1, Canonical URL
- PageSpeed Audit Status, PageSpeed Audit Error, PageSpeed Audit Reason, PageSpeed Audit Date, Audit Date

The app's Excel export has multiple sheets (summary, all companies, Good/Medium/Bad/Needs Review groupings, follow-ups, team operations, team workload) and enriches the business export with audit fields, Google Review Points, and Business Type. CSV is a simpler business list export. Verify the latest implementation before promising that a specific field appears in a particular export format.

## 7. Supabase setup scaffold

`supabase-setup.sql` creates:

- `team_members` linked to `auth.users` with a profile trigger.
- `business_leads` with JSONB lead data.
- Row-level security policies/functions that allow authenticated team members to read/write shared leads.

`SUPABASE_SETUP.md` says to create a project, run the SQL, invite four team email accounts, disable public signups, and configure only the Supabase project URL plus public anon/publishable key in the client. The service-role/secret key must never be placed in browser code. Current status: scaffold only, not wired into the app. To make the user's requested four-person live ERP real, the next developer must implement sign-in, load/save/synchronize leads via Supabase, map authenticated users/team names, and handle initial seeding/migration carefully. Do not copy a service-role key or password into files or chat.

## 8. Security and privacy notes

- A Google PageSpeed API key was previously pasted into this conversation. It is intentionally omitted here. Treat it as exposed; the owner should rotate/restrict it and configure API restrictions/quotas before future use.
- Never write API secrets, Supabase service-role keys, passwords, or private credentials in README, HTML, JS, CSV, ZIP, or source control.
- Supabase URL and anon/publishable key are client-side identifiers, but access still depends on correct RLS and auth policies. Never use the service-role key client-side.
- Business contact details in the CSV are user data. Share only with the intended team and avoid including unnecessary personal data in public demos.

## 9. Immediate instructions for the next AI agent

1. Read this README before touching any data.
2. Treat `website-full-analysis.csv` and `analyzed-leads-data.js` as the current 102-record curated seed. Keep them aligned if changing the seed dataset.
3. Do not use the 8,821/other bulk prospect workbooks/CSVs or any old audit part files for analysis. The user will upload the next curated file explicitly.
4. Do not claim Google reviews, Google ratings, LinkedIn discovery, Google Drive, Sheets sync, login, or multi-user cloud sync work until those integrations have been implemented and verified.
5. If the user uploads a curated Excel/CSV, inspect its headers/URLs, preserve its source data, de-duplicate websites, analyze only that upload, and clearly report failed/unchecked sources instead of silently labeling them complete.
6. Keep website grading automated and read-only in the UI. Filters should select records based on automatically derived values.
7. For any requested Google review acquisition, choose an authorized, policy-compliant source (for example, a properly configured Google Places API integration) and explain coverage/quota limits. Do not scrape Google Maps pages as a substitute for an authorized API.
8. Before implementing live team access, connect Supabase auth/database correctly with RLS, and verify four distinct users can share the same records; localStorage-only behavior is not sufficient.
9. Update this README whenever data counts, analysis scope, migration behavior, integrations, or security posture change.

## 10. Useful references in this workspace

- Current curated report: `website-full-analysis.csv`
- Current app: `index.html`
- PageSpeed / import analysis extension: `website-audit.js`
- Embedded curated seed: `analyzed-leads-data.js`
- Latest code ZIP: `Canvass-ERP-source-20261122.zip`
- Supabase scaffold: `supabase-setup.sql`, `SUPABASE_SETUP.md`


## Smart Lead Finder upgrade
Open index.html (prefer a local HTTP server: `python -m http.server 8000`, then http://localhost:8000). Smart Lead Finder appears above the original Maps finder. Manual entry and approval require no API. Live discovery requires a Google Cloud project with billing and Places API (New) enabled; use a restricted key, never a shared unrestricted key. The key is held in the input for the current session only. Search up to 60 results, filter by listing website and review signals. Google results are temporary references, not exportable CRM records; independently verify and manually enter prospects for retention. Review counts and missing website listings are signals, not verified business deficiencies. Existing website audits remain available. No live API or browser end-to-end testing was performed. Existing localStorage is origin-specific; back up your current data and use the same origin to retain workflow history. No changes to seed data or Supabase configuration.

## Website Sales Intelligence V2
Open index.html, then Website sales intelligence in the sidebar. KPIs distinguish recorded successful audits, pending websites, and missing URLs. The ranked table uses deficits below 80 in recorded audit scores; this is an internal heuristic, not a sales probability. Enter actual services one per line; exact matching labels are Website optimization, SEO services, Accessibility improvements, Website maintenance. Generate and copy a pitch only for successfully audited websites with measured issues. Historical audits are not fresh checks. Review drafts before sending. Smart Finder now has a website-listed filter and official website research links; Google Places discovery remains API-dependent and missing URLs require manual verification. No live API or browser testing performed.

## V3: Canvass service catalogue and pitch generator
Seven default services are configured. Select a validated website in Website sales intelligence, then choose Email, WhatsApp or Call script. Low SEO, mobile performance and best-practices scores map to SEO, optimization and maintenance. Accessibility flags require review before redesign is offered. Other service needs require manual confirmation; selections reset when selecting a business. Review all drafts and recheck old audits before sending. No messages are sent automatically. Service settings are browser-local. Existing lead data and storage key remain unchanged. JavaScript syntax and six pitch-engine assertions tested; live API and browser UI not tested.

## V4 service catalogue
Eight services replace V3 defaults. The V4 service settings use a new local storage key; lead data is unchanged. SEO scores do not measure AEO visibility. Social media, advertising, content and integrated marketing require independent confirmation per prospect. Select Review / generate pitch on a validated website, then confirm any additional service needs. No pitch is generated for invalid audits.

## V5 — 360° Digital Audit
Open index.html and select 360° Audit. Select an existing prospect, confirm official website ownership with evidence, and record independent research for local search, AEO, social, ads, content and other services. Save review. Generate proposal/pitch only after a successful technical audit and ownership confirmation. Print client audit using browser print (Save as PDF). Compare recorded scores with another audited prospect; dates are displayed, not a live competitor benchmark. Review data is saved locally with lead records. Existing bulk PageSpeed audit remains available; Google Places requires an API key and independent verification before importing. Research links open searches; they do not automatically audit social, AEO or advertising. No live API/browser test has been performed. Serve via localhost for best browser compatibility.
