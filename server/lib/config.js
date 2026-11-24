'use strict';
// Default, user-editable configuration. API keys live only on the server and are masked when sent to the browser.

const INDUSTRIES = [
  { id: 'interior-design', name: 'Interior design', types: ['interior_designer'], keywords: ['interior', 'fit-out', 'fit out', 'fitout', 'decor', 'joinery', 'design studio'] },
  { id: 'construction', name: 'Construction', types: ['general_contractor', 'electrician', 'plumber', 'roofing_contractor', 'painter', 'hardware_store'], keywords: ['construction', 'contracting', 'contractor', 'building', 'civil', 'renovation', 'maintenance services'] },
  { id: 'real-estate', name: 'Real estate', types: ['real_estate_agency'], keywords: ['real estate', 'properties', 'property', 'realty', 'homes', 'brokerage'] },
  { id: 'restaurants-cafes', name: 'Restaurants and cafés', types: ['restaurant', 'cafe', 'coffee_shop', 'bakery', 'meal_takeaway', 'meal_delivery', 'fast_food_restaurant', 'ice_cream_shop', 'juice_shop', 'dessert_shop', 'bar', 'food'], typeSuffix: '_restaurant', keywords: ['restaurant', 'cafe', 'café', 'coffee', 'kitchen', 'bistro', 'eatery', 'grill', 'bakery', 'shawarma'] },
  { id: 'healthcare', name: 'Healthcare and clinics', types: ['doctor', 'dentist', 'dental_clinic', 'hospital', 'medical_lab', 'physiotherapist', 'pharmacy', 'drugstore', 'chiropractor', 'skin_care_clinic', 'wellness_center', 'health'], keywords: ['clinic', 'medical', 'dental', 'health', 'physio', 'dermatology', 'polyclinic', 'diagnostic'] },
  { id: 'beauty-spa', name: 'Beauty salons and spas', types: ['beauty_salon', 'hair_salon', 'hair_care', 'spa', 'nail_salon', 'barber_shop', 'beautician', 'massage', 'makeup_artist'], keywords: ['salon', 'spa', 'beauty', 'barber', 'nails', 'lashes', 'massage', 'grooming'] },
  { id: 'fashion-retail', name: 'Fashion and retail', types: ['clothing_store', 'shoe_store', 'jewelry_store', 'store', 'department_store', 'gift_shop', 'home_goods_store', 'furniture_store', 'florist', 'shopping_mall'], keywords: ['fashion', 'boutique', 'clothing', 'apparel', 'jewellery', 'jewelry', 'abaya', 'store', 'shop'] },
  { id: 'automobile', name: 'Automobile', types: ['car_repair', 'car_dealer', 'car_wash', 'auto_parts_store', 'car_rental'], keywords: ['auto', 'car ', 'cars', 'garage', 'motors', 'tyre', 'tire', 'detailing', 'automotive'] },
  { id: 'logistics', name: 'Logistics', types: ['moving_company', 'storage', 'courier_service', 'trucking_company'], keywords: ['logistics', 'freight', 'cargo', 'shipping', 'courier', 'transport', 'movers', 'warehousing'] },
  { id: 'manufacturing', name: 'Manufacturing', types: ['manufacturer'], keywords: ['manufacturing', 'manufacturer', 'factory', 'industries', 'industrial', 'fabrication'] },
  { id: 'education', name: 'Education', types: ['school', 'primary_school', 'secondary_school', 'university', 'preschool', 'library'], keywords: ['training', 'institute', 'academy', 'education', 'tutoring', 'learning', 'nursery', 'school', 'courses'] },
  { id: 'professional-services', name: 'Professional services', types: ['accounting', 'lawyer', 'insurance_agency', 'consultant', 'travel_agency', 'corporate_office'], keywords: ['consult', 'legal', 'law firm', 'accounting', 'audit', 'advisory', 'business setup', 'pro services', 'chartered'] },
  { id: 'ecommerce', name: 'E-commerce', types: [], keywords: ['online', 'e-commerce', 'ecommerce', 'store', 'shop'] },
  { id: 'it-services', name: 'IT services', types: ['computer_store', 'electronics_store'], keywords: ['software', 'it services', 'it solutions', 'technology', 'tech', 'web', 'digital', 'computer', 'networking', 'cyber'] },
  { id: 'sme', name: 'Small and medium enterprises', types: [], keywords: [], matchesAny: true }
];

// Service catalogue (Canvass). Grouped; each can be switched off in Settings.
const SERVICES = [
  ['website', 'Website design'], ['website', 'Website redesign'], ['website', 'Website development'], ['website', 'Custom WordPress development'],
  ['website', 'E-commerce development'], ['website', 'Web application development'], ['website', 'Website integrations'], ['website', 'Website maintenance'],
  ['website', 'Website optimization'], ['website', 'Domain and hosting support'], ['website', 'Website backups and monitoring'],
  ['search', 'Technical SEO'], ['search', 'Local SEO'], ['search', 'Keyword research'], ['search', 'Content optimization'],
  ['search', 'Google Business Profile optimization'], ['search', 'Answer Engine Optimization (AEO)'],
  ['creative', 'Branding'], ['creative', 'Graphic design'], ['creative', 'Business photography'], ['creative', 'Product photography'],
  ['creative', 'Video and reels creation'], ['creative', 'Creative content development'], ['creative', 'Copywriting'],
  ['marketing', 'Social media management'], ['marketing', 'Content planning'], ['marketing', 'Social media campaigns'], ['marketing', 'Google Ads'],
  ['marketing', 'Meta Ads'], ['marketing', 'Facebook and Instagram advertising'], ['marketing', 'Lead generation campaigns'],
  ['marketing', 'Digital marketing strategy'], ['marketing', 'Analytics and reporting'], ['search', 'Reputation and review management']
].map(([group, name]) => ({ group, name, enabled: true }));

const DEFAULTS = {
  version: 1,
  googlePlacesKey: '',
  pageSpeedKey: '',
  defaultCountry: 'United Arab Emirates',
  eligibilityYears: 5,            // rolling window, always measured from today's date
  activeMinEvidence: 2,           // independent signals needed besides Google's OPERATIONAL status
  recentReviewMonths: 12,
  acceptEstimatedAge: false,      // OFF = only documented establishment evidence verifies age (honest default)
  ageMinSources: 2,               // used only when acceptEstimatedAge is ON
  rejectOldWebsiteArchive: true,  // reject when the site's earliest archive capture is older than the window and nothing newer is documented
  largeCompanyReviewThreshold: 1000,
  chainLocationThreshold: 3,
  requireConfirmedIssue: true,
  maxCandidatesPerSearch: 120,
  weights: { age: 20, activity: 25, gbp: 25, website: 20, contact: 10 },
  priority: { high: 80, medium: 60 },
  benchmarks: { default: { minReviews: 20, minRating: 4.0, minPhotos: 5 }, 'restaurants-cafes': { minReviews: 50, minRating: 4.2, minPhotos: 10 }, 'beauty-spa': { minReviews: 30, minRating: 4.3, minPhotos: 8 }, 'healthcare': { minReviews: 30, minRating: 4.2, minPhotos: 5 } },
  industries: INDUSTRIES,
  services: SERVICES,
  company: { name: 'Canvass', tagline: 'Discover. Validate. Analyse. Convert.', sender: 'Team Canvass', phone: '', email: '', website: '' },
  team: ['Member 1', 'Member 2', 'Member 3', 'Member 4'],
  googleRetentionDays: 30,
  includeGoogleContentInExports: false,
  runPageSpeed: true,
  brokenLinkSample: 12,
  concurrency: 2,
  contactCooldownDays: 14,
  demoMode: false,
  costPer1000: { places: 40, pagespeed: 0, rdap: 0, wayback: 0, website: 0 },
  schedules: []
};

const SECRET_FIELDS = ['googlePlacesKey', 'pageSpeedKey'];

function mask(v) { return v ? '••••' + String(v).slice(-4) : ''; }

function publicSettings(s) {
  const out = JSON.parse(JSON.stringify(s));
  for (const f of SECRET_FIELDS) { out[f] = mask(s[f]); out[f + 'Configured'] = !!s[f]; }
  out.googlePlacesKeyFromEnv = !!process.env.GOOGLE_PLACES_API_KEY;
  out.pageSpeedKeyFromEnv = !!process.env.PAGESPEED_API_KEY;
  return out;
}

function effectiveKey(s, field) {
  const env = { googlePlacesKey: process.env.GOOGLE_PLACES_API_KEY, pageSpeedKey: process.env.PAGESPEED_API_KEY }[field];
  return env || s[field] || '';
}

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** Merge a settings patch from the browser, validating every field. Masked secrets are ignored. */
function applySettingsPatch(cur, p) {
  const s = JSON.parse(JSON.stringify(cur));
  for (const f of SECRET_FIELDS) {
    if (typeof p[f] === 'string' && !p[f].startsWith('••••')) s[f] = p[f].trim();
  }
  if (typeof p.defaultCountry === 'string') s.defaultCountry = p.defaultCountry.trim().slice(0, 80) || s.defaultCountry;
  s.eligibilityYears = num(p.eligibilityYears, 1, 20, s.eligibilityYears);
  s.activeMinEvidence = num(p.activeMinEvidence, 1, 5, s.activeMinEvidence);
  s.recentReviewMonths = num(p.recentReviewMonths, 1, 36, s.recentReviewMonths);
  s.ageMinSources = num(p.ageMinSources, 1, 3, s.ageMinSources);
  s.largeCompanyReviewThreshold = num(p.largeCompanyReviewThreshold, 50, 100000, s.largeCompanyReviewThreshold);
  s.chainLocationThreshold = num(p.chainLocationThreshold, 2, 50, s.chainLocationThreshold);
  s.maxCandidatesPerSearch = num(p.maxCandidatesPerSearch, 5, 500, s.maxCandidatesPerSearch);
  s.googleRetentionDays = num(p.googleRetentionDays, 1, 30, s.googleRetentionDays);
  s.brokenLinkSample = num(p.brokenLinkSample, 0, 50, s.brokenLinkSample);
  s.concurrency = num(p.concurrency, 1, 5, s.concurrency);
  s.contactCooldownDays = num(p.contactCooldownDays, 0, 365, s.contactCooldownDays);
  for (const b of ['acceptEstimatedAge', 'rejectOldWebsiteArchive', 'requireConfirmedIssue', 'includeGoogleContentInExports', 'runPageSpeed', 'demoMode'])
    if (typeof p[b] === 'boolean') s[b] = p[b];
  if (p.weights) for (const k of Object.keys(s.weights)) s.weights[k] = num(p.weights[k], 0, 100, s.weights[k]);
  if (p.priority) { s.priority.high = num(p.priority.high, 1, 100, s.priority.high); s.priority.medium = num(p.priority.medium, 0, s.priority.high, s.priority.medium); }
  if (p.costPer1000) for (const k of Object.keys(s.costPer1000)) s.costPer1000[k] = num(p.costPer1000[k], 0, 10000, s.costPer1000[k]);
  if (p.benchmarks && typeof p.benchmarks === 'object') for (const [k, v] of Object.entries(p.benchmarks)) {
    if (!v || typeof v !== 'object') continue;
    const base = s.benchmarks[k] || s.benchmarks.default;
    s.benchmarks[k] = { minReviews: num(v.minReviews, 0, 100000, base.minReviews), minRating: num(v.minRating, 1, 5, base.minRating), minPhotos: num(v.minPhotos, 0, 10, base.minPhotos) };
  }
  if (p.company && typeof p.company === 'object') for (const k of Object.keys(s.company)) if (typeof p.company[k] === 'string') s.company[k] = p.company[k].trim().slice(0, 200);
  if (Array.isArray(p.team)) s.team = p.team.map(x => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 20);
  if (Array.isArray(p.services)) s.services = p.services.filter(x => x && x.name).map(x => ({ group: String(x.group || 'website'), name: String(x.name).slice(0, 80), enabled: x.enabled !== false }));
  if (Array.isArray(p.industries)) s.industries = p.industries.filter(x => x && x.name).map(x => ({
    id: String(x.id || x.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), name: String(x.name).slice(0, 60),
    types: (Array.isArray(x.types) ? x.types : String(x.types || '').split(',')).map(t => String(t).trim()).filter(Boolean),
    keywords: (Array.isArray(x.keywords) ? x.keywords : String(x.keywords || '').split(',')).map(t => String(t).trim().toLowerCase()).filter(Boolean),
    typeSuffix: x.typeSuffix || undefined, matchesAny: !!x.matchesAny }));
  return s;
}

module.exports = { DEFAULTS, INDUSTRIES, SERVICES, publicSettings, applySettingsPatch, effectiveKey, SECRET_FIELDS };
