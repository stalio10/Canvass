'use strict';
// Google Business Profile audit + customer review analysis. Uses only data returned by the authorized Places API.
const { monthsBetween, isValidDate } = require('./util');
const CONFIRMED = 'Confirmed Issue', POTENTIAL = 'Potential Improvement';

const THEMES = [
  ['Staff and service', /\b(staff|service|rude|friendly|helpful|polite|attitude|customer service|manager|team)\b/i],
  ['Quality of work or product', /\b(quality|excellent|poor|bad job|workmanship|finish|taste|delicious|tasty|fresh|result|professional)\b/i],
  ['Price and value', /\b(price|expensive|cheap|overpriced|value|cost|charges?|affordable|money)\b/i],
  ['Waiting time and speed', /\b(wait(ed|ing)?|late|delay(ed)?|slow|quick|fast|on time|took (too )?long|hours? to)\b/i],
  ['Cleanliness', /\b(clean|dirty|hygien\w*|smell|messy|tidy)\b/i],
  ['Communication and follow-up', /\b(call(ed)? back|respon(se|d|sive)|no reply|ignored|whatsapp|follow[- ]?up|communication|answer(ed)? the phone)\b/i],
  ['Booking and appointments', /\b(appointment|booking|booked|reservation|schedul\w*)\b/i],
  ['Delivery', /\b(deliver(y|ed)|courier|shipping|order (arrived|never))\b/i],
  ['Location and parking', /\b(parking|location|hard to find|directions|access)\b/i]
];
const NEGATIVE_WORDS = /\b(not|never|worst|terrible|awful|poor|rude|bad|disappoint\w*|unprofessional|waste|horrible|avoid|scam|overpriced|dirty|late|delay\w*|ignored)\b/i;

function analyzeReviews(google, settings, today = new Date()) {
  const analysedAt = new Date().toISOString();
  if (!google || google.expired) return { status: 'Not Available', note: google?.expired ? 'Google data expired after the retention period — refresh to re-analyse.' : 'No Google Business data for this company.', analysedAt };
  const reviews = (google.reviews || []).filter(r => r.text || r.rating != null);
  const base = { rating: google.rating, totalReviews: google.userRatingCount, sampleSize: reviews.length, analysedAt, source: google.googleMapsUri || 'Google Places API',
    authenticityNote: 'Reviews are customer opinions supplied by Google. Their authenticity has not been independently verified.',
    sampleNote: `Analysis uses the ${reviews.length} review(s) Google returns through the API (maximum 5), not the full review history.`,
    ownerReplies: { status: 'Not Available', note: 'The Places API does not report whether the owner replied to reviews.' } };
  if (!reviews.length) return { ...base, status: google.userRatingCount ? 'No sample' : 'No reviews', positiveThemes: [], negativeThemes: [], repeatedComplaints: [], recentDates: [], confidence: 'Not Applicable' };
  const pos = {}, neg = {};
  const items = reviews.map(r => {
    const sentiment = r.rating >= 4 ? 'positive' : r.rating <= 2 ? 'negative' : NEGATIVE_WORDS.test(r.text) ? 'negative' : 'mixed';
    const themes = THEMES.filter(([, re]) => re.test(r.text)).map(([t]) => t);
    for (const t of themes) { if (sentiment === 'positive') pos[t] = (pos[t] || 0) + 1; if (sentiment === 'negative') neg[t] = (neg[t] || 0) + 1; }
    return { date: isValidDate(r.publishTime) ? r.publishTime.slice(0, 10) : '', rating: r.rating, sentiment, themes, author: r.author, excerpt: r.text.slice(0, 220) };
  });
  const toList = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([theme, count]) => ({ theme, count }));
  const repeated = toList(neg).filter(x => x.count >= 2);
  const recentDates = items.map(i => i.date).filter(Boolean).sort().reverse();
  const opportunities = [];
  if (repeated.length) opportunities.push('Respond to recurring feedback about ' + repeated.map(r => r.theme.toLowerCase()).join(', '));
  if (items.some(i => i.sentiment === 'negative')) opportunities.push('Review management: public, professional responses to negative reviews');
  if (!recentDates.length || monthsBetween(recentDates[0], today) > settings.recentReviewMonths) opportunities.push('Encourage recent customers to leave reviews');
  return { ...base, status: 'Analysed', items, positiveThemes: toList(pos), negativeThemes: toList(neg), repeatedComplaints: repeated, recentDates, opportunities,
    confidence: reviews.length >= 4 ? 'Medium' : 'Low', confidenceNote: 'Confidence is limited by the small review sample available through the API.' };
}

function benchmarkFor(settings, industryId) { return { ...settings.benchmarks.default, ...(settings.benchmarks[industryId] || {}) }; }

function auditGbp(google, { industryId, websiteKnown, websiteUrl, reviewAnalysis }, settings, today = new Date()) {
  if (!google || !google.placeId) return { status: 'Not Available', note: 'No Google Business Profile matched this company.', issues: [] };
  if (google.expired) return { status: 'Not Available', note: 'Google data expired after the retention period — refresh to audit again.', issues: [] };
  const b = benchmarkFor(settings, industryId);
  const issues = [];
  const add = (id, group, status, title, detail, services) => issues.push({ id, area: 'gbp', group, status, title, detail, services, evidence: google.googleMapsUri || 'Google Places API', checkedAt: google.fetchedAt });
  // Location and directions
  if (!google.formattedAddress) add('gbp-no-address', 'Location', CONFIRMED, 'Missing business address', 'No address on the Google Business Profile.', ['Google Business Profile optimization', 'Local SEO']);
  else {
    const types = new Set((google.addressComponents || []).flatMap(c => c.types || []));
    if (!['street_number', 'route', 'premise', 'subpremise', 'street_address'].some(t => types.has(t)) && !/\d/.test(google.formattedAddress))
      add('gbp-incomplete-address', 'Location', POTENTIAL, 'Address may be incomplete', `Listed as "${google.formattedAddress}" with no street or building.`, ['Google Business Profile optimization', 'Local SEO']);
  }
  if (!google.location) add('gbp-no-pin', 'Location', CONFIRMED, 'No map location', 'Profile has no map coordinates, so directions cannot be given.', ['Google Business Profile optimization']);
  // Profile completeness
  if (!google.websiteUri) {
    if (websiteKnown) add('gbp-website-not-linked', 'Profile', CONFIRMED, 'Website not linked on Google profile', `The business has a website (${websiteUrl}) but the profile does not link to it.`, ['Google Business Profile optimization', 'Local SEO']);
    else add('gbp-no-website', 'Profile', POTENTIAL, 'No website listed on Google profile', 'Not proof the business has no website — no website was found in the checked sources either.', ['Website design', 'Website development', 'Google Business Profile optimization']);
  }
  if (!google.nationalPhoneNumber && !google.internationalPhoneNumber) add('gbp-no-phone', 'Profile', CONFIRMED, 'No phone number on profile', 'Customers cannot call from Google Maps.', ['Google Business Profile optimization']);
  if (!google.regularOpeningHours?.weekdayDescriptions?.length) add('gbp-no-hours', 'Profile', CONFIRMED, 'Working hours missing', 'No opening hours on the profile.', ['Google Business Profile optimization']);
  if (!google.editorialSummary) add('gbp-no-description', 'Profile', POTENTIAL, 'No business summary available', 'Google returned no editorial summary. The owner-written description is not available through the API, so this is a prompt to check.', ['Google Business Profile optimization', 'Copywriting']);
  const specific = (google.types || []).filter(t => !['point_of_interest', 'establishment'].includes(t));
  if (!google.primaryType || specific.length < 2) add('gbp-category', 'Profile', POTENTIAL, 'Business categories may be incomplete', `Categories found: ${specific.join(', ') || 'none'}.`, ['Google Business Profile optimization', 'Local SEO']);
  // Photos
  if (!google.photoCount) add('gbp-no-photos', 'Photos', CONFIRMED, 'No photos on profile', 'Google returned no photos for this business.', ['Business photography', 'Google Business Profile optimization']);
  else if (google.photoCount < b.minPhotos) add('gbp-few-photos', 'Photos', POTENTIAL, 'Few photos visible', `${google.photoCount} photo(s) returned (API shows at most 10; benchmark ${b.minPhotos}).`, ['Business photography', 'Product photography']);
  // Reviews
  const count = google.userRatingCount;
  if (!count) add('gbp-no-reviews', 'Reviews', CONFIRMED, 'No customer reviews', 'The profile has no Google reviews.', ['Reputation and review management', 'Google Business Profile optimization']);
  else if (count < b.minReviews) add('gbp-low-reviews', 'Reviews', CONFIRMED, 'Low review count', `${count} reviews (industry benchmark ${b.minReviews}).`, ['Reputation and review management']);
  if (google.rating != null && count && google.rating < b.minRating) add('gbp-low-rating', 'Reviews', CONFIRMED, 'Rating below benchmark', `Rated ${google.rating} (benchmark ${b.minRating}).`, ['Reputation and review management']);
  const dates = (google.reviews || []).map(r => r.publishTime).filter(isValidDate).sort();
  if (count && dates.length && monthsBetween(dates[dates.length - 1], today) > settings.recentReviewMonths)
    add('gbp-no-recent-reviews', 'Reviews', POTENTIAL, 'No recent reviews in available sample', `Latest review in the API sample is from ${dates[dates.length - 1].slice(0, 10)}.`, ['Reputation and review management']);
  for (const r of reviewAnalysis?.repeatedComplaints || [])
    add('gbp-complaint-' + r.theme.toLowerCase().replace(/\W+/g, '-'), 'Reviews', POTENTIAL, `Repeated customer feedback: ${r.theme.toLowerCase()}`, `Mentioned in ${r.count} negative reviews in the available sample (customer opinions, not verified facts).`, ['Reputation and review management']);
  // Local SEO summary
  const profileGaps = issues.filter(i => ['Location', 'Profile'].includes(i.group)).length;
  if (profileGaps >= 3) add('gbp-incomplete', 'Local SEO', POTENTIAL, 'Incomplete Google presence', `${profileGaps} profile gaps reduce local search visibility.`, ['Local SEO', 'Google Business Profile optimization']);
  return { status: 'Checked', checkedAt: google.fetchedAt, benchmark: b, issues,
    notChecked: ['Unanswered reviews (not available through the Places API)', 'Exact map pin accuracy (requires on-site confirmation)', 'Full photo and review history (API returns samples only)'] };
}

module.exports = { auditGbp, analyzeReviews, benchmarkFor, THEMES };
