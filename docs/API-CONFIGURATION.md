# API configuration

Canvass uses only authorised data sources. It does not scrape Google Maps pages.

| Source | Used for | Key needed | Cost |
|---|---|---|---|
| Google Places API (New): Text Search, Place Details | Discovering businesses; address, map location, phone, website link, hours, status, rating, review count, up to 5 reviews, photo count, categories | **Yes** | Billed by Google (pay-as-you-go, with a monthly free tier). Check current pricing |
| Google PageSpeed Insights API v5 | Mobile Lighthouse scores (performance, SEO, accessibility, best practices) | Optional (recommended) | Free |
| RDAP (via rdap.org) | Domain registration date (supporting evidence only) | No | Free |
| Internet Archive Wayback CDX | First archived capture of the website (website age estimate) | No | Free |
| The business's own website | Website audit, public emails, social links | No | Free |

## 1. Google Places API key

1. Go to <https://console.cloud.google.com/> and create a project, for example "Canvass Lead Finder".
2. **Billing** → link a billing account. Places API (New) needs billing even within the free tier.
3. **APIs & Services → Library** → search **"Places API (New)"** → **Enable**.
4. **APIs & Services → Credentials → Create credentials → API key**.
5. Click the new key → **API restrictions → Restrict key → Places API (New)** → Save.
   - The key is used by the Canvass **server**, not the browser, so "Websites" (HTTP referrer) restrictions won't work. Use **IP address** restrictions if your office has a fixed IP, or none.
6. **Quotas**: in **APIs & Services → Places API (New) → Quotas**, set a daily cap on *Text Search requests* so a mistake can't run up a bill.
7. In Canvass, go to **Settings → API keys** and paste the key → **Save settings**.

### What a search costs

The finder shows an estimate before you start. One Text Search page returns up to 20 businesses and is one billed request. A search for 10 qualified leads analyses up to 60 companies (3 to 15 requests, depending on how many query variations run). Canvass asks for all fields in the search request itself, so it doesn't make a second "details" call per company. The **Reports and Backup → API usage** table counts every request and estimates cost from the price you enter in Settings. Your Google Cloud billing page shows the actual charges.

## Staying within the free tier

Use both layers below. Together they make it very hard to be charged for Google Places.

**Layer 1: Canvass limits (built in, on by default).** Go to **Settings → Free-tier protection**. Canvass counts every Google Places request, including failed ones, by calendar month in Pacific Time (the way Google bills). Once the monthly or daily limit is reached, it refuses to send another request. A search that hits the limit stops early and still processes the companies already found. The sidebar shows "Google requests: used / limit this month".

- Default: **500 per month, 100 per day**.
- Open Google's Places API pricing page, find the free monthly calls for **Text Search (Enterprise + Atmosphere)**, and set the monthly limit a little below that number. Google changes its pricing from time to time, so check it occasionally.

**Layer 2: Google quota caps (set once in Google Cloud).** Go to **APIs & Services → Places API (New) → Quotas & system limits**. Edit *Text Search requests per day* (and *Place Details requests per day*) to a low number, for example 50 per day. Google then refuses extra requests itself, even if something else used the key.

**Also:** set **Billing → Budgets & alerts** to email you at $1. A budget alert only warns you and does not stop spending; the quota caps are what stop it.

**What is not covered.** If the key is copied and used outside Canvass, only Layer 2 protects you. Restrict the key to Places API (New) and PageSpeed Insights API, and keep it private.

## 2. PageSpeed Insights key (optional)

1. In the same project, enable **PageSpeed Insights API**.
2. Create another API key and restrict it to **PageSpeed Insights API**.
3. Paste it in **Settings → PageSpeed Insights API key**.

Without a key, Canvass uses Google's shared anonymous quota, which is often exhausted. The audit then shows "PageSpeed: Failed – quota exceeded" and **no scores are shown**. Canvass never estimates scores.

## 3. Keeping keys safe

- Keys are stored in `data/canvass-db.json` on the PC running Canvass. They are shown masked (`••••1234`) in the browser and are **excluded from backup downloads**.
- Alternatively, set them as environment variables (`GOOGLE_PLACES_API_KEY`, `PAGESPEED_API_KEY`). These override Settings.
- Never paste keys into chat, email, HTML files or GitHub.
- If a key is exposed, delete it in Google Cloud and create a new one.

## 4. Google Maps Platform terms, as built in

- **Caching**: Google content (rating, reviews, photos, hours, address, Google-only phone numbers) is deleted after **30 days** (configurable lower). The Place ID is kept so the record can be refreshed. Contact details your team confirms independently ("Contact details confirmed") are kept.
- **Exports** exclude Google content by default. Turning it on in Settings is your decision and responsibility.
- **Attribution**: Google data is labelled "Google Maps data © Google", and review authors are shown with their reviews.

## 5. Not connected (needs your decision and credentials)

| Integration | Why it isn't on | What it would need |
|---|---|---|
| Company registry APIs (for example UAE DED / free-zone registries) | No public, authorised API is available for automated lookups | A licensed data provider. Until then, add licence dates on the company card or in the upload (`Established Date` and `Established Source` columns) |
| Automatic email sending | Needs your mail server credentials, unsubscribe handling and consent policy | SMTP or an email service API with a verified domain |
| WhatsApp Business API | Needs Meta business verification and approved message templates | A WhatsApp Business Platform account |
| Social media activity APIs | Instagram/Facebook APIs only cover accounts you manage | Use "Add verification evidence → Recent activity" after checking manually |
