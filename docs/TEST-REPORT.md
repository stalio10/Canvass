# Validation test report

**Product:** CANVASS Lead Finder ERP v1.0.0
**Date:** 2026-11-24
**Command:** `npm test` (Node.js built-in test runner, Node v22.23.5)
**Result:** **65 of 65 automated tests passed.**

## Scope

| Test file | Covers |
|---|---|
| `test/rules.test.js` | Mandatory validation rules, age, activity, industry, location, size, scoring, services |
| `test/audit.test.js` | Website analysis, Google Business audit, review analysis, pitch honesty |
| `test/engine.test.js` | Discovery and bulk engine, duplicates, API failures, missing data, pipeline transfer, retention, backups |
| `test/budget.test.js` | Free-tier protection: monthly and daily limits, nothing sent beyond the limit, partial searches |
| `test/api.test.js` | REST API security, key masking, pipeline rules, contact cooldown, exports, demo data |

External APIs are **mocked** in the automated tests: Google Places, RDAP, Internet Archive, PageSpeed and websites. That makes the results repeatable and avoids billing. The mocks return the same response shapes as the real services.

## Results

| Result | Test |
|---|---|
| ✅ Pass | write requests without the app header are refused (cross-site protection) |
| ✅ Pass | API keys are masked and never returned |
| ✅ Pass | demo data loads, is labelled, and powers the dashboard only in demo mode |
| ✅ Pass | pipeline: only qualified leads, stage validation, notes and history |
| ✅ Pass | contact log prevents duplicate messages and respects do-not-contact |
| ✅ Pass | evidence requires a source and re-validates immediately |
| ✅ Pass | exports exclude Google content by default and produce CSV |
| ✅ Pass | clearing demo data turns demo mode off and leaves production figures empty |
| ✅ Pass | static files are served with a strict content security policy; path traversal blocked |
| ✅ Pass | HTML analysis extracts real on-page facts |
| ✅ Pass | Cloudflare-protected emails are decoded |
| ✅ Pass | a well-built site has no confirmed issues |
| ✅ Pass | measured problems become confirmed issues |
| ✅ Pass | PageSpeed scores are only used when the test actually ran |
| ✅ Pass | our own network failure is never reported as the business’s problem |
| ✅ Pass | JavaScript-rendered sites get potential (not confirmed) content issues |
| ✅ Pass | complete profile → no confirmed Google issues |
| ✅ Pass | missing profile items become issues; missing website link is not proof of no website |
| ✅ Pass | industry benchmarks are applied |
| ✅ Pass | no Google profile or expired data → Not Available, no invented issues |
| ✅ Pass | review analysis is honest about sample size, authenticity and owner replies |
| ✅ Pass | no reviews → no invented themes |
| ✅ Pass | pitches only for qualified leads, built from real findings, with opt-out and no guarantees |
| ✅ Pass | bulk input parsing: headers, aliases, plain URL lists, Maps links |
| ✅ Pass | duplicate detection by Place ID, domain, phone, name+location and name↔domain |
| ✅ Pass | Google discovery end-to-end with mocked Places API: pagination, dedupe, validation, pipeline transfer |
| ✅ Pass | accepting consistent estimates qualifies companies without manual dates |
| ✅ Pass | Places API failure stops the job with a clear message and stores nothing fake |
| ✅ Pass | discovery refuses to start without an API key |
| ✅ Pass | HTTP retries on 429 then succeeds |
| ✅ Pass | private network addresses are blocked (SSRF guard) |
| ✅ Pass | bulk upload without Google key: missing information stays Unverified, never invented |
| ✅ Pass | Google content is purged after the retention period; Place ID kept |
| ✅ Pass | backups exclude API keys and restore round-trips |
| ✅ Pass | requests stop at the monthly limit and nothing is sent beyond it |
| ✅ Pass | daily limit is enforced separately |
| ✅ Pass | failed requests also count, so the cap errs on the safe side |
| ✅ Pass | other free services are never blocked by the Places limit |
| ✅ Pass | discovery refuses to start at the limit, and stops mid-search keeping what was found |
| ✅ Pass | limits can be switched off deliberately |
| ✅ Pass | qualified only when every mandatory rule passes |
| ✅ Pass | closed businesses are rejected |
| ✅ Pass | companies older than the window are rejected |
| ✅ Pass | unverified age keeps a lead out of the pipeline |
| ✅ Pass | unverified activity, uncertain industry, unknown location → Unverified |
| ✅ Pass | irrelevant industry, out of location, large, duplicate, invalid → Rejected |
| ✅ Pass | no public contact information → Unverified |
| ✅ Pass | only potential improvements → No Opportunity (default), Qualified when setting allows |
| ✅ Pass | a high score never overrides a failed mandatory rule |
| ✅ Pass | score is 0–100 with configurable priority bands |
| ✅ Pass | documented establishment date inside the window verifies age |
| ✅ Pass | documented date older than the window → verified but outside |
| ✅ Pass | the five-year window moves with the current date |
| ✅ Pass | domain and archive dates alone are only an estimate (not verified) |
| ✅ Pass | old domain alone does not reject (domain may predate the business) |
| ✅ Pass | a customer review older than the window proves the business is older |
| ✅ Pass | no evidence → Not Available, never an invented date |
| ✅ Pass | a Google listing alone is not proof of activity |
| ✅ Pass | operational + recent review + hours + phone → Verified |
| ✅ Pass | few or old reviews do not make a business inactive, just unverified |
| ✅ Pass | closed statuses are detected |
| ✅ Pass | industry relevance uses Google types and keywords |
| ✅ Pass | location matching rejects other cities and flags unknown addresses |
| ✅ Pass | large and chain businesses are detected |
| ✅ Pass | services come only from findings and enabled catalogue entries |

## Live checks against real services

These were run by hand from the development machine on the date above. They are not repeated automatically.

| Check | Result |
|---|---|
| Website audit of a real UAE business site (aabtools.com) | ✅ Reachable (HTTP 200), HTTPS, sitemap found, viewport, 2 forms, WhatsApp link and 5 social profiles detected. The public email `websales@aabtools.com` was extracted from a Cloudflare-protected link and matches the previous dataset |
| Broken-link checker | ✅ After a fix, Cloudflare email-protection links are no longer reported as broken (this was a false positive in the first run) |
| RDAP domain lookup (aabtools.com) | ✅ Registration date 2003-12-17 returned from the Verisign RDAP server. Correctly treated as supporting evidence only: the age stays *Unverified* rather than rejecting the company |
| PageSpeed Insights without a key | ✅ Google returned "quota exceeded"; the audit recorded **Failed** and showed no scores (correct behaviour) |
| Internet Archive lookup | ⚠️ Not completed. The development network's proxy reset the connection; the result was recorded as *Not Available*. Retest on the office network |
| Bulk upload end-to-end (3 real entries, no Places key) | ✅ All three processed, emails found, all correctly **Unverified** ("operational status not confirmed by Google or the team"), none transferred to the pipeline |
| Google Places API (real key) | ⏳ **Not tested live.** No key was available. Covered by mocked tests (pagination, closed, out-of-area, large and duplicate businesses, and API errors). Run one small search (for example 3 leads) after adding your key |
| Browser UI (Chromium, desktop 1400px and phone 390px) | ✅ All 7 pages and the company card load with no console errors and no horizontal page overflow |

## Defects found and fixed during testing

1. **Our own network failure was reported as "Website is not loading" (Confirmed Issue).** Fixed: when the site can't be reached, Canvass first checks this computer's internet connection. If it's offline, the audit is marked *Not checked* and no issue is raised.
2. **Cloudflare email-protection link reported as a broken link.** Fixed: such technical paths are excluded, and protected emails are decoded.
3. **The same company entered as a name and as a URL in one upload created two records.** Fixed: duplicates inside an upload are removed before parallel processing, and names are matched against website domains.
4. **Demo companies shared one placeholder phone number, so duplicate detection merged them.** Fixed by giving each its own placeholder (this also confirmed that phone-based duplicate detection works).

## Known limitations

- Google's API returns at most 5 reviews and 10 photos per business. Review themes and photo counts are samples and are labelled as such.
- Whether the owner replies to reviews is not available through the Places API (shown as *Not Available*).
- No automated company-registry lookup. Establishment dates come from your team or the upload, with a required source.
- With the default settings, a company found automatically stays **Unverified** until its establishment date is documented. This is deliberate (no estimated dates presented as facts). Switch on *Accept consistent estimates* in Settings to qualify companies on matching domain and archive dates instead.
