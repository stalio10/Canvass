'use strict';
// DEMONSTRATION DATA ONLY. Fictional businesses on reserved ".example" domains, flagged demo:true and hidden unless Demo mode is on.
const { newRecord, mergeGoogle, processCompany } = require('./engine');
const { deriveIssues } = require('./website-audit');

const daysAgo = d => new Date(Date.now() - d * 86400000).toISOString();
const dateAgo = d => daysAgo(d).slice(0, 10);

function g({ id, name, address, city = 'Dubai', area = '', types, status = 'OPERATIONAL', rating, count, reviews = [], photos = 3, hours = true, phone = true, website = '' }) {
  return { placeId: 'DEMO_' + id + '_xxxxxxxx', fetchedAt: new Date().toISOString(), source: 'DEMO DATA (not from Google)', displayName: name,
    formattedAddress: address, addressComponents: [{ longText: area || city, types: ['sublocality'] }, { longText: city, types: ['locality'] }, { longText: 'United Arab Emirates', shortText: 'AE', types: ['country'] }],
    location: { latitude: 25.2, longitude: 55.27 }, googleMapsUri: 'https://maps.google.com/?q=' + encodeURIComponent('DEMO ' + name), websiteUri: website,
    nationalPhoneNumber: phone ? '+971 4 000 00' + String(id).padStart(2, '0') + ' (demo)' : '', businessStatus: status, regularOpeningHours: hours ? { weekdayDescriptions: ['Monday: 9 AM – 6 PM (demo)'] } : null,
    rating, userRatingCount: count, reviews, photoCount: photos, primaryType: types[0], primaryTypeDisplayName: types[0].replace(/_/g, ' '), types: [...types, 'point_of_interest', 'establishment'], editorialSummary: '' };
}
const rv = (days, rating, text) => ({ rating, text, publishTime: daysAgo(days), author: 'Demo reviewer' });

function site(url, page, extra = {}) {
  const a = { status: 'Checked', url, finalUrl: url, domain: new URL(url).hostname, checkedAt: new Date().toISOString(), demo: true,
    availability: { ok: true, httpStatus: 200, responseMs: extra.responseMs || 900 }, https: { usesHttps: url.startsWith('https'), httpRedirectsToHttps: extra.redirect ?? true },
    sitemap: extra.sitemap ?? false, brokenLinks: extra.broken || { checked: 10, broken: [] },
    pagespeed: { status: 'Tested', source: 'DEMO values — not a real test', testedAt: new Date().toISOString(), ...extra.ps },
    page: { title: '', metaDescription: null, viewport: true, robots: '', canonical: null, h1s: ['Welcome'], wordCount: 400, ldTypes: [], imageCount: 6, imagesWithoutAlt: 1,
      forms: 0, emails: [], social: {}, whatsapp: false, tel: true, mailto: true, ctas: [], contactPage: url + 'contact', copyrightYear: new Date().getFullYear(),
      generator: '', ecomSignals: [], mapEmbed: false, addressOnSite: false, jsRendered: false, questionHeadings: 0, ...page } };
  a.issues = deriveIssues(a, {});
  return a;
}

const DEMOS = [
  { name: 'Olive & Oak Interiors', industryId: 'interior-design', area: 'Al Quoz', est: dateAgo(700), google: { id: 1, address: 'Warehouse 12, Al Quoz 3, Dubai (demo)', area: 'Al Quoz', types: ['interior_designer'], rating: 4.6, count: 14, reviews: [rv(20, 5, 'Friendly team and great quality finish.'), rv(90, 4, 'Good design, a bit of a wait for the quote.')], photos: 2, website: 'https://olive-oak.example/' },
    audit: ['https://olive-oak.example/', { title: 'Home', metaDescription: null, email: '' }, { ps: { performance: 38, seo: 72, accessibility: 85, bestPractices: 78 } }] },
  { name: 'Glow Lab Beauty Lounge', industryId: 'beauty-spa', area: 'Jumeirah', est: dateAgo(400), noWebsite: true, google: { id: 2, address: 'Shop 4, Jumeirah Beach Road, Dubai (demo)', area: 'Jumeirah', types: ['beauty_salon'], rating: 4.8, count: 9, reviews: [rv(10, 5, 'Lovely staff, very clean.'), rv(45, 5, 'Best nails in the area.')], photos: 4 } },
  { name: 'Bayside Physio Clinic', industryId: 'healthcare', area: 'Dubai Marina', est: dateAgo(1300), google: { id: 3, address: 'Office 210, Marina Plaza, Dubai Marina (demo)', area: 'Dubai Marina', types: ['physiotherapist'], rating: 3.8, count: 26, reviews: [rv(15, 2, 'Had to wait 40 minutes past my appointment.'), rv(60, 2, 'Long wait again and no call back.'), rv(100, 5, 'Helpful therapist.')], photos: 6, website: 'https://bayside-physio.example/' },
    audit: ['https://bayside-physio.example/', { title: 'Bayside Physio Clinic | Physiotherapy in Dubai Marina', metaDescription: 'Physiotherapy clinic in Dubai Marina.', forms: 1, ctas: ['Book now'], addressOnSite: true, ldTypes: ['MedicalClinic'] }, { ps: { performance: 61, seo: 92, accessibility: 88, bestPractices: 96 }, sitemap: true }] },
  { name: 'Nomad Coffee Roasters', industryId: 'restaurants-cafes', area: 'Business Bay', sources: { rdap: dateAgo(900), wayback: dateAgo(850) }, google: { id: 4, address: 'Bay Square 7, Business Bay, Dubai (demo)', area: 'Business Bay', types: ['coffee_shop', 'cafe'], rating: 4.4, count: 31, reviews: [rv(5, 5, 'Excellent coffee.')], photos: 8, website: 'https://nomad-coffee.example/' },
    audit: ['https://nomad-coffee.example/', { title: 'Nomad Coffee Roasters', metaDescription: 'Specialty coffee.', whatsapp: false }, { ps: { performance: 55, seo: 85, accessibility: 90, bestPractices: 92 } }] },
  { name: 'Falcon Auto Detailing', industryId: 'automobile', area: 'Al Qusais', google: { id: 5, address: 'Al Qusais Industrial Area 2, Dubai (demo)', area: 'Al Qusais', types: ['car_wash'], rating: 4.1, count: 6, reviews: [rv(800, 4, 'Good job on my car.')], photos: 1, hours: false } },
  { name: 'Al Noor Interiors', industryId: 'interior-design', area: 'Deira', google: { id: 6, address: 'Al Rigga Road, Deira, Dubai (demo)', area: 'Deira', types: ['interior_designer'], rating: 4.0, count: 85, reviews: [rv(2900, 4, 'Used them years ago, good service.'), rv(30, 3, 'Okay.')], photos: 9, website: 'https://alnoor-interiors.example/' } },
  { name: 'Urban Fit Studio', industryId: 'beauty-spa', area: 'JLT', google: { id: 7, address: 'Cluster D, JLT, Dubai (demo)', area: 'JLT', types: ['spa'], status: 'CLOSED_PERMANENTLY', rating: 4.2, count: 40, photos: 5 } },
  { name: 'MegaMart Interiors Superstore', industryId: 'interior-design', area: 'Al Barsha', google: { id: 8, address: 'Mall of the Emirates area, Al Barsha, Dubai (demo)', area: 'Al Barsha', types: ['interior_designer', 'home_goods_store'], rating: 4.3, count: 3200, photos: 10, website: 'https://megamart.example/' } },
  { name: 'Corniche Dental Care', industryId: 'healthcare', area: 'Al Khalidiyah', google: { id: 9, address: 'Corniche Road, Al Khalidiyah, Abu Dhabi (demo)', city: 'Abu Dhabi', area: 'Al Khalidiyah', types: ['dental_clinic'], rating: 4.7, count: 60, photos: 7 } },
  { name: 'Pixel Perfect IT Solutions', industryId: 'it-services', area: 'Dubai Internet City', est: dateAgo(500), google: { id: 10, address: 'Building 5, Dubai Internet City (demo)', area: 'Dubai Internet City', types: ['computer_store'], rating: 4.9, count: 64, reviews: [rv(12, 5, 'Very professional and quick.')], photos: 10, website: 'https://pixel-perfect.example/' },
    audit: ['https://pixel-perfect.example/', { title: 'Pixel Perfect IT Solutions | Managed IT in Dubai', metaDescription: 'Managed IT services and support for Dubai SMEs.', canonical: 'https://pixel-perfect.example/', forms: 1, whatsapp: true, ctas: ['Get a quote'], addressOnSite: true, ldTypes: ['LocalBusiness', 'FAQPage'], social: { linkedin: 'https://linkedin.com/company/demo' } }, { ps: { performance: 92, seo: 100, accessibility: 95, bestPractices: 100 }, sitemap: true }] }
];

async function loadDemo(store) {
  const settings = { ...store.settings, demoMode: true };
  const ind = id => settings.industries.find(i => i.id === id)?.name || '';
  let n = 0;
  for (const d of DEMOS) {
    const c = newRecord({ name: '[DEMO] ' + d.name, demo: true, industryId: d.industryId, industryName: ind(d.industryId), country: 'United Arab Emirates', city: 'Dubai', area: d.area,
      source: { type: 'demo', detail: 'Demonstration data — fictional company', at: new Date().toISOString() } });
    mergeGoogle(c, g({ ...d.google, name: '[DEMO] ' + d.name }));
    c.name = '[DEMO] ' + d.name;
    if (d.est) c.manual.establishment = { date: d.est, source: 'DEMO trade licence record (fictional)', enteredAt: new Date().toISOString(), by: 'Demo' };
    if (d.noWebsite) { c.manual.noWebsiteConfirmed = true; c.manual.noWebsiteNote = 'DEMO: team confirmed no website exists.'; c.manual.noWebsiteAt = new Date().toISOString(); }
    if (d.audit) c.websiteAudit = site(...d.audit);
    if (d.sources) c.ageSources = { rdap: { status: 'Found', date: d.sources.rdap, source: 'DEMO domain record', checkedAt: new Date().toISOString() }, wayback: { status: 'Found', date: d.sources.wayback, source: 'DEMO archive record', checkedAt: new Date().toISOString() } };
    if (store.findDuplicate(c)) continue;
    await processCompany(c, { settings, offline: true });
    store.put(c); n++;
  }
  return n;
}

function clearDemo(store) {
  let n = 0;
  for (const c of Object.values(store.state.companies)) if (c.demo) { delete store.state.companies[c.id]; n++; }
  store.save(); return n;
}

module.exports = { loadDemo, clearDemo };
