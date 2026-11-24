'use strict';
// Dashboard statistics and export tables — always computed from stored, processed records.

function dashboard(store) {
  const all = store.allCompanies();
  const by = (fn) => all.reduce((m, c) => { const k = fn(c) || 'Not set'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const cat = c => c.validation?.category || 'Unprocessed';
  const inPipe = all.filter(c => c.pipeline?.inPipeline);
  const today = new Date().toISOString().slice(0, 10);
  const issueCats = {}, serviceCounts = {};
  for (const c of all) {
    for (const i of c.issues || []) { const k = i.area === 'gbp' ? 'Google profile · ' + (i.group || 'Profile') : 'Website · ' + websiteGroup(i.id); issueCats[k] = (issueCats[k] || 0) + 1; }
    if (cat(c) === 'Qualified') for (const s of c.services || []) serviceCounts[s.name] = (serviceCounts[s.name] || 0) + 1;
  }
  const stages = ['New', 'Contacted', 'Follow-up', 'Proposal sent', 'Negotiation', 'Won', 'Lost'];
  return {
    demoMode: store.settings.demoMode, demoRecords: Object.values(store.state.companies).filter(c => c.demo).length,
    totals: {
      discovered: all.length,
      active: all.filter(c => c.activity?.status === 'Verified').length,
      withinWindow: all.filter(c => c.age?.withinWindow === true).length,
      qualified: all.filter(c => cat(c) === 'Qualified').length,
      unverified: all.filter(c => cat(c) === 'Unverified').length,
      rejected: all.filter(c => cat(c) === 'Rejected').length,
      noOpportunity: all.filter(c => cat(c) === 'No Opportunity').length,
      withoutWebsite: all.filter(c => ['Not found', 'Confirmed none'].includes(c.websiteStatus)).length,
      weakGbp: all.filter(c => (c.gbpAudit?.issues || []).filter(i => i.status === 'Confirmed Issue').length >= 2).length,
      websiteIssues: all.filter(c => (c.websiteAudit?.issues || []).some(i => i.status === 'Confirmed Issue')).length,
      highPriority: all.filter(c => cat(c) === 'Qualified' && c.score?.priority === 'High').length,
      transferred: inPipe.length,
      followUpsDue: inPipe.filter(c => c.pipeline.followUpDate && c.pipeline.followUpDate <= today && !['Won', 'Lost'].includes(c.pipeline.stage)).length,
      converted: inPipe.filter(c => c.pipeline.stage === 'Won').length,
      duplicatesSkipped: store.state.duplicates.length
    },
    charts: {
      validation: by(cat),
      industry: by(c => c.industryName || c.industry || 'Not set'),
      location: by(c => [c.area, c.city].filter(Boolean).join(', ') || c.country || 'Not set'),
      issues: issueCats, services: serviceCounts,
      pipeline: Object.fromEntries(stages.map(s => [s, inPipe.filter(c => c.pipeline.stage === s).length])),
      priority: by(c => cat(c) === 'Qualified' ? c.score?.priority : null)
    },
    generatedAt: new Date().toISOString()
  };
}
function websiteGroup(id) {
  if (/^ps-performance|slow|site-down/.test(id)) return 'Performance & availability';
  if (/https|redirect/.test(id)) return 'Security (HTTPS)';
  if (/title|meta|h1|canonical|sitemap|noindex|ps-seo/.test(id)) return 'Technical SEO';
  if (/enquiry|form|whatsapp|cta/.test(id)) return 'Enquiries & conversion';
  if (/local|address/.test(id)) return 'Local SEO';
  if (/aeo/.test(id)) return 'AEO readiness';
  if (/no-website/.test(id)) return 'No website';
  return 'Design, content & maintenance';
}

const DATASETS = {
  qualified: c => c.validation?.category === 'Qualified', unverified: c => c.validation?.category === 'Unverified',
  rejected: c => c.validation?.category === 'Rejected', 'no-opportunity': c => c.validation?.category === 'No Opportunity',
  pipeline: c => c.pipeline?.inPipeline, all: () => true
};

function exportTable(store, dataset = 'qualified') {
  const filter = DATASETS[dataset] || DATASETS.qualified;
  const s = store.settings, incG = s.includeGoogleContentInExports;
  const contactVal = (c, f) => { const src = c.contactSources?.[f] || ''; return !incG && src.startsWith('Google') && !c.contactVerifiedAt ? '' : (c.contact?.[f] || ''); };
  const header = ['Company', 'Validation', 'Reasons', 'Priority', 'Lead score', 'Industry', 'Country', 'City', 'Area', 'Phone', 'Email', 'Website', 'Website status',
    'Business status', 'Company age status', 'Earliest dated evidence', 'Website first archived', 'Detected issues', 'Recommended services', 'Pipeline stage',
    'Assigned to', 'Follow-up date', 'Last verified', 'Evidence sources', 'Lead source', 'Record ID'];
  if (incG) header.splice(17, 0, 'Google rating', 'Google review count', 'Google Maps link');
  const rows = store.allCompanies().filter(filter).map(c => {
    const r = [c.name, c.validation?.category || '', (c.validation?.reasons || []).join(' | '), c.validation?.category === 'Qualified' ? c.score?.priority : '', c.score?.total ?? '',
      c.industryName || c.industry, c.country, c.city, c.area, contactVal(c, 'phone'), contactVal(c, 'email'), c.contact?.website || '', c.websiteStatus || '',
      c.activity?.status || '', c.age?.status || '', c.age?.earliestDate || '', c.age?.websiteAge?.firstSeen || '',
      (c.issues || []).map(i => `${i.title} [${i.status}]`).join(' | '), (c.services || []).map(x => x.name).join(', '), c.pipeline?.stage || '',
      c.pipeline?.assignedTo || '', c.pipeline?.followUpDate || '', (c.lastVerifiedAt || '').slice(0, 16).replace('T', ' '),
      [...new Set([...(c.age?.evidence || []).map(e => e.source), c.google?.placeId ? 'Google Places API' : '', c.websiteAudit ? 'Website audit ' + (c.websiteAudit.checkedAt || '').slice(0, 10) : ''].filter(Boolean))].join('; '),
      c.source?.detail || c.source?.type || '', c.id];
    if (incG) r.splice(17, 0, c.google?.rating ?? '', c.google?.userRatingCount ?? '', c.google?.googleMapsUri || '');
    return r;
  });
  return { header, rows, note: incG ? 'Includes Google Maps content. Check Google Maps Platform terms before sharing outside your team.' : 'Google Maps content (ratings, reviews and Google-only contact details) is excluded, as required by Google Maps Platform terms. Change this in Settings.' };
}

const csvCell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
function toCsv({ header, rows }) { return '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n'); }

module.exports = { dashboard, exportTable, toCsv, DATASETS };
