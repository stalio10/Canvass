'use strict';
// Google Places API (New) client. Authorized API only — no scraping of Google Maps pages.
const { httpFetch, ApiError } = require('./util');

const BASE = 'https://places.googleapis.com/v1';
const PLACE_FIELDS = ['id', 'displayName', 'formattedAddress', 'addressComponents', 'location', 'googleMapsUri', 'websiteUri',
  'nationalPhoneNumber', 'internationalPhoneNumber', 'businessStatus', 'regularOpeningHours', 'rating', 'userRatingCount',
  'reviews', 'photos', 'primaryType', 'primaryTypeDisplayName', 'types', 'editorialSummary'];

async function parse(res) {
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    const hint = res.status === 403 ? ' (check that Places API (New) is enabled and the key allows it)' : res.status === 429 ? ' (quota exceeded — try later or raise the quota)' : '';
    throw new ApiError('Google Places: ' + msg + hint, { status: res.status, api: 'places', retryable: res.status === 429 || res.status >= 500 });
  }
  return data;
}

/** One page of Text Search (max 20 results). Returns { places, nextPageToken }. */
async function textSearch(apiKey, { textQuery, pageToken, pageSize = 20, regionCode, languageCode = 'en' }) {
  if (!apiKey) throw new ApiError('Google Places API key is not configured (Settings → API keys).', { api: 'places' });
  const body = { textQuery, pageSize: Math.min(20, pageSize), languageCode };
  if (regionCode) body.regionCode = regionCode;
  if (pageToken) body.pageToken = pageToken;
  const res = await httpFetch(BASE + '/places:searchText', {
    api: 'places', method: 'POST', timeoutMs: 30000,
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'nextPageToken,' + PLACE_FIELDS.map(f => 'places.' + f).join(',') },
    body: JSON.stringify(body)
  });
  const data = await parse(res);
  return { places: data.places || [], nextPageToken: data.nextPageToken || '' };
}

async function placeDetails(apiKey, placeId) {
  if (!apiKey) throw new ApiError('Google Places API key is not configured (Settings → API keys).', { api: 'places' });
  if (!/^[A-Za-z0-9_-]{10,}$/.test(placeId)) throw new ApiError('Invalid Google Place ID');
  const res = await httpFetch(`${BASE}/places/${encodeURIComponent(placeId)}`, {
    api: 'places', timeoutMs: 30000, headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': PLACE_FIELDS.join(',') }
  });
  return parse(res);
}

/** Flatten a Places API result into the record's `google` block (with fetch timestamp for retention). */
function toGoogleBlock(p) {
  return {
    placeId: p.id, fetchedAt: new Date().toISOString(), source: 'Google Places API (New)',
    displayName: p.displayName?.text || '', formattedAddress: p.formattedAddress || '', addressComponents: p.addressComponents || [],
    location: p.location || null, googleMapsUri: p.googleMapsUri || '', websiteUri: p.websiteUri || '',
    nationalPhoneNumber: p.nationalPhoneNumber || '', internationalPhoneNumber: p.internationalPhoneNumber || '',
    businessStatus: p.businessStatus || '', regularOpeningHours: p.regularOpeningHours ? { weekdayDescriptions: p.regularOpeningHours.weekdayDescriptions || [] } : null,
    rating: typeof p.rating === 'number' ? p.rating : null, userRatingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    reviews: (p.reviews || []).map(r => ({ rating: r.rating ?? null, text: r.text?.text || r.originalText?.text || '', publishTime: r.publishTime || '',
      relativeTime: r.relativePublishTimeDescription || '', author: r.authorAttribution?.displayName || '', authorUri: r.authorAttribution?.uri || '' })),
    photoCount: Array.isArray(p.photos) ? p.photos.length : 0,
    photoAttributions: (p.photos || []).slice(0, 3).flatMap(ph => (ph.authorAttributions || []).map(a => a.displayName)).filter(Boolean),
    primaryType: p.primaryType || '', primaryTypeDisplayName: p.primaryTypeDisplayName?.text || '', types: p.types || [],
    editorialSummary: p.editorialSummary?.text || ''
  };
}

/** Pull a usable reference out of a pasted Google Maps link (place ID, name, coordinates). Short links are resolved by the caller. */
function parseMapsLink(link) {
  const out = {};
  let u; try { u = new URL(link); } catch { return out; }
  const q = u.searchParams;
  if (q.get('query_place_id')) out.placeId = q.get('query_place_id');
  if (q.get('place_id')) out.placeId = q.get('place_id');
  if (q.get('cid')) out.cid = q.get('cid');
  const m = u.pathname.match(/\/maps\/place\/([^/]+)/);
  if (m) out.name = decodeURIComponent(m[1].replace(/\+/g, ' '));
  if (!out.name && q.get('query')) out.name = q.get('query');
  if (!out.name && q.get('q')) out.name = q.get('q');
  const at = u.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) out.coords = { lat: Number(at[1]), lng: Number(at[2]) };
  return out;
}
const isMapsLink = s => /^(https?:\/\/)?((www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(String(s || '').trim());

module.exports = { textSearch, placeDetails, toGoogleBlock, parseMapsLink, isMapsLink, PLACE_FIELDS };
