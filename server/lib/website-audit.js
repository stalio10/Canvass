'use strict';
// Website audit: every score or issue here comes from a request this engine actually made.
const { internetOk, httpFetch, readTextLimited, normalizeUrl, domainOf, registrableDomain, ApiError } = require('./util');

const CONFIRMED = 'Confirmed Issue', POTENTIAL = 'Potential Improvement';

const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null; };
const metaContent = (html, key) => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const n = (attr(tag, 'name') || attr(tag, 'property') || '').toLowerCase();
    if (n === key) return (attr(tag, 'content') || '').trim();
  }
  return null;
};

function visibleText(html) {
  return decode(html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Pure HTML analysis — unit-tested without network. */
function analyzeHtml(html, pageUrl, ctx = {}) {
  const base = new URL(pageUrl);
  const host = registrableDomain(base.hostname);
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? decode(titleM[1]).replace(/\s+/g, ' ').trim() : '';
  const h1s = (html.match(/<h1\b[\s\S]*?<\/h1>/gi) || []).map(h => visibleText(h)).filter(Boolean);
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => ({ href: attr(m[1], 'href') || '', text: visibleText(m[2]).slice(0, 80) }));
  const links = []; const internal = new Set();
  for (const a of anchors) {
    try {
      const u = new URL(a.href, base);
      links.push({ ...a, url: u.href, protocol: u.protocol, host: u.hostname });
      if (['http:', 'https:'].includes(u.protocol) && registrableDomain(u.hostname) === host) { u.hash = ''; internal.add(u.href); }
    } catch { /* malformed href */ }
  }
  const text = visibleText(html);
  const words = text ? text.split(' ').length : 0;
  const ldTypes = [];
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = o => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk); if (o['@type']) [].concat(o['@type']).forEach(t => ldTypes.push(String(t))); if (o['@graph']) walk(o['@graph']); };
      walk(JSON.parse(m[1].trim()));
    } catch { ldTypes.push('(invalid JSON-LD)'); }
  }
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const noAlt = imgs.filter(t => { const a = attr(t, 'alt'); return a === null; }).length;
  const forms = (html.match(/<form\b[\s\S]*?<\/form>/gi) || []).filter(f => /<(input|textarea)\b/i.test(f));
  const emails = new Set();
  for (const l of links) if (l.protocol === 'mailto:') emails.add(decodeURIComponent(l.url.slice(7).split('?')[0]).toLowerCase());
  for (const m of text.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) emails.add(m[0].toLowerCase());
  // Cloudflare "email protection" hides addresses as XOR-encoded hex; decode them so public emails are still found.
  for (const m of html.matchAll(/data-cfemail\s*=\s*["']([0-9a-f]+)["']|\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) {
    const hex = m[1] || m[2]; const key = parseInt(hex.slice(0, 2), 16); let e = '';
    for (let i = 2; i < hex.length; i += 2) e += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) emails.add(e.toLowerCase());
  }
  const realEmails = [...emails].filter(e => !/\.(png|jpe?g|gif|webp|svg)$/i.test(e) && !/(example\.|sentry|wixpress|domain\.com|email\.com)/i.test(e));
  const social = {};
  for (const l of links) {
    const h = l.host || '';
    for (const [k, re] of [['instagram', /instagram\.com$/], ['facebook', /(facebook|fb)\.com$/], ['linkedin', /linkedin\.com$/], ['tiktok', /tiktok\.com$/], ['x', /(twitter|x)\.com$/], ['youtube', /youtube\.com$/]])
      if (re.test(h.replace(/^www\./, '')) && !social[k] && !/sharer|share\?|intent\/tweet/i.test(l.url)) social[k] = l.url;
  }
  const whatsapp = links.some(l => /wa\.me|api\.whatsapp\.com|whatsapp:\/\/|web\.whatsapp\.com/i.test(l.url)) || /wa\.me\/|api\.whatsapp\.com/i.test(html);
  const ctaRe = /(get (a )?(free )?quote|request (a )?quote|contact us|book( now| an appointment| a call)?|call (us|now)|enquire|inquire|get started|order now|buy now|shop now|schedule|free consultation|whatsapp us|send (an )?enquiry)/i;
  const ctas = [...new Set([...links.map(l => l.text), ...(html.match(/<button\b[\s\S]*?<\/button>/gi) || []).map(visibleText)].filter(t => t && ctaRe.test(t)).map(t => t.slice(0, 40)))].slice(0, 8);
  const contactLink = links.find(l => /contact|enquir|inquir|get-in-touch|reach-us/i.test(l.url + ' ' + l.text) && l.host && registrableDomain(l.host) === host);
  const copyrightYears = [...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map(m => +m[1]).filter(y => y > 1995 && y <= new Date().getFullYear() + 1);
  const generator = metaContent(html, 'generator') || '';
  const ecomSignals = [];
  if (/add[ -]to[ -]cart|add to bag/i.test(text)) ecomSignals.push('Add to cart button');
  if (/woocommerce/i.test(html)) ecomSignals.push('WooCommerce');
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(html)) ecomSignals.push('Shopify');
  if (/\/cart\b|\/checkout\b/i.test(html)) ecomSignals.push('Cart/checkout links');
  if (/magento|bigcommerce|opencart|prestashop/i.test(html)) ecomSignals.push('E-commerce platform');
  const lowerText = text.toLowerCase();
  const addressOnSite = (ctx.city && lowerText.includes(String(ctx.city).toLowerCase())) || /\b(p\.?\s?o\.?\s?box|street|road|building|floor|office\s?\d+|suite)\b/i.test(text);
  const jsRendered = words < 80 && /<div[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>|__NEXT_DATA__|ng-version|data-reactroot/i.test(html);
  return {
    title, metaDescription: metaContent(html, 'description'), ogTitle: metaContent(html, 'og:title'),
    viewport: !!metaContent(html, 'viewport'), robots: metaContent(html, 'robots') || '', lang: (html.match(/<html[^>]*\blang\s*=\s*["']?([\w-]+)/i) || [])[1] || '',
    canonical: (() => { const t = (html.match(/<link\b[^>]*rel\s*=\s*["']?canonical[^>]*>/i) || [])[0]; return t ? attr(t, 'href') : null; })(),
    h1s, wordCount: words, ldTypes, imageCount: imgs.length, imagesWithoutAlt: noAlt, forms: forms.length,
    emails: realEmails.slice(0, 5), social, whatsapp, tel: links.some(l => l.protocol === 'tel:'), mailto: links.some(l => l.protocol === 'mailto:'),
    ctas, contactPage: contactLink ? contactLink.url : null, internalLinks: [...internal].slice(0, 200),
    copyrightYear: copyrightYears.length ? Math.max(...copyrightYears) : null, generator, ecomSignals,
    mapEmbed: /google\.[a-z.]+\/maps\/embed|maps\.google\.[a-z.]+.*output=embed/i.test(html), addressOnSite, jsRendered,
    questionHeadings: (html.match(/<h[2-4]\b[^>]*>[^<]*\?\s*<\/h[2-4]>/gi) || []).length
  };
}

async function fetchPage(url) {
  const res = await httpFetch(url, { api: 'website', guard: true, timeoutMs: 20000, retries: 1, headers: { accept: 'text/html,application/xhtml+xml' } });
  const type = res.headers.get('content-type') || '';
  const html = /html|xml|text\/plain/i.test(type) || !type ? await readTextLimited(res) : '';
  return { res, html, type };
}

async function headStatus(url) {
  try {
    let res = await httpFetch(url, { api: 'website', guard: true, method: 'HEAD', timeoutMs: 12000, retries: 0 });
    if (res.status === 405 || res.status === 403 || res.status === 501) { res = await httpFetch(url, { api: 'website', guard: true, timeoutMs: 12000, retries: 0 }); try { await res.body?.cancel(); } catch { /* ignore */ } }
    return res.status;
  } catch (e) { return 'error: ' + e.message.slice(0, 80); }
}

async function runPageSpeed(url, key) {
  const u = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  u.searchParams.set('url', url); u.searchParams.set('strategy', 'mobile');
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) u.searchParams.append('category', c);
  if (key) u.searchParams.set('key', key);
  const res = await httpFetch(u.href, { api: 'pagespeed', timeoutMs: 120000, retries: 2 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.lighthouseResult) throw new ApiError('PageSpeed: ' + (data.error?.message || 'HTTP ' + res.status), { status: res.status, api: 'pagespeed' });
  const cat = data.lighthouseResult.categories || {}, au = data.lighthouseResult.audits || {};
  const sc = k => Number.isFinite(cat[k]?.score) ? Math.round(cat[k].score * 100) : null;
  return { status: 'Tested', strategy: 'mobile', testedAt: new Date().toISOString(), source: 'Google PageSpeed Insights (Lighthouse)',
    performance: sc('performance'), seo: sc('seo'), accessibility: sc('accessibility'), bestPractices: sc('best-practices'),
    lcp: au['largest-contentful-paint']?.displayValue || '', cls: au['cumulative-layout-shift']?.displayValue || '', tbt: au['total-blocking-time']?.displayValue || '' };
}

/** Turn measurements into issues. Each issue: confirmed (measured) or potential (opportunity), plus the services it maps to. */
function deriveIssues(a, ctx = {}) {
  const out = [];
  const add = (id, status, title, detail, services) => out.push({ id, area: 'website', status, title, detail, services, evidence: a.finalUrl || a.url, checkedAt: a.checkedAt });
  if (a.availability.networkProblem) return out; // our connection failed — say nothing about the business's site
  if (!a.availability.ok) {
    add('site-down', CONFIRMED, 'Website is not loading', a.availability.error || `Server returned HTTP ${a.availability.httpStatus}`, ['Website redesign', 'Website maintenance', 'Domain and hosting support']);
    return out;
  }
  const p = a.page, soft = p.jsRendered ? POTENTIAL : CONFIRMED;
  if (!a.https.usesHttps) add('no-https', CONFIRMED, 'Website does not use HTTPS', 'Final page was served over plain HTTP.', ['Domain and hosting support', 'Website maintenance']);
  else if (a.https.httpRedirectsToHttps === false) add('http-no-redirect', POTENTIAL, 'HTTP version does not redirect to HTTPS', 'Visitors typing the plain address may land on an insecure page.', ['Domain and hosting support']);
  if (!p.viewport) add('no-viewport', CONFIRMED, 'Not set up for mobile screens', 'No responsive viewport meta tag was found on the homepage.', ['Website redesign', 'Website optimization']);
  if (a.availability.responseMs > 3000) add('slow-response', POTENTIAL, 'Slow server response', `Homepage took ${(a.availability.responseMs / 1000).toFixed(1)}s to respond in one measurement.`, ['Website optimization', 'Domain and hosting support']);
  const ps = a.pagespeed;
  if (ps?.status === 'Tested') {
    if (ps.performance != null && ps.performance < 50) add('ps-performance', CONFIRMED, 'Poor mobile performance', `PageSpeed mobile performance ${ps.performance}/100 (LCP ${ps.lcp || 'n/a'}).`, ['Website optimization']);
    else if (ps.performance != null && ps.performance < 80) add('ps-performance', POTENTIAL, 'Mobile performance can improve', `PageSpeed mobile performance ${ps.performance}/100.`, ['Website optimization']);
    if (ps.seo != null && ps.seo < 80) add('ps-seo', CONFIRMED, 'Technical SEO score below 80', `Lighthouse SEO ${ps.seo}/100.`, ['Technical SEO']);
    if (ps.accessibility != null && ps.accessibility < 80) add('ps-a11y', POTENTIAL, 'Accessibility can improve', `Lighthouse accessibility ${ps.accessibility}/100. Review before proposing a redesign.`, ['Website design']);
    if (ps.bestPractices != null && ps.bestPractices < 80) add('ps-bp', POTENTIAL, 'Best-practice issues found', `Lighthouse best practices ${ps.bestPractices}/100.`, ['Website maintenance']);
  }
  if (!p.title) add('no-title', soft, 'Missing page title', 'Homepage has no <title>.', ['Technical SEO']);
  else if (p.title.length < 15 || p.title.length > 65) add('title-length', POTENTIAL, 'Page title length is not optimal', `Title is ${p.title.length} characters: "${p.title.slice(0, 70)}"`, ['Technical SEO', 'Content optimization']);
  if (!p.metaDescription) add('no-meta-desc', soft, 'Missing meta description', 'Search results will show auto-generated text.', ['Technical SEO', 'Copywriting']);
  if (!p.h1s.length) add('no-h1', soft, 'No main heading (H1)', 'Homepage has no H1 heading.', ['Technical SEO', 'Content optimization']);
  else if (p.h1s.length > 1) add('multi-h1', POTENTIAL, 'Multiple H1 headings', `${p.h1s.length} H1 headings on the homepage.`, ['Technical SEO']);
  if (/noindex/i.test(p.robots)) add('noindex', CONFIRMED, 'Homepage blocks search engines', 'robots meta tag contains "noindex".', ['Technical SEO']);
  if (!p.canonical) add('no-canonical', POTENTIAL, 'No canonical URL', 'Canonical link tag not found.', ['Technical SEO']);
  if (a.sitemap === false) add('no-sitemap', POTENTIAL, 'No sitemap.xml found', '/sitemap.xml did not return a page.', ['Technical SEO']);
  const hasEnquiry = p.forms > 0 || a.contactPageForms > 0;
  if (!p.contactPage && !hasEnquiry && !p.tel && !p.whatsapp) add('no-enquiry', soft, 'No clear way to enquire', 'No contact page, enquiry form, phone link or WhatsApp link found.', ['Website redesign', 'Website integrations']);
  else if (!hasEnquiry) add('no-form', POTENTIAL, 'No enquiry form found', 'Checked the homepage' + (p.contactPage ? ' and contact page.' : '.'), ['Website integrations']);
  if (!p.whatsapp) add('no-whatsapp', POTENTIAL, 'No WhatsApp integration', 'No WhatsApp chat link found on the homepage.', ['Website integrations']);
  if (!p.ctas.length) add('no-cta', POTENTIAL, 'No clear call-to-action', 'No "Get a quote", "Book", "Contact us" style buttons detected.', ['Website redesign', 'Copywriting']);
  const hasLocalSchema = p.ldTypes.some(t => /LocalBusiness|Organization|Store|Restaurant|MedicalClinic|Dentist|BeautySalon|ProfessionalService|AutoRepair|RealEstateAgent/i.test(t));
  if (!hasLocalSchema) add('no-local-schema', POTENTIAL, 'No business structured data', 'No LocalBusiness/Organization schema found.', ['Local SEO', 'Answer Engine Optimization (AEO)']);
  if (!p.addressOnSite && !p.mapEmbed && !a.contactPageAddress) add('no-address', POTENTIAL, 'Location not shown on website', 'No address or map found on homepage' + (p.contactPage ? ' or contact page.' : '.'), ['Local SEO']);
  if (!p.ldTypes.some(t => /FAQPage|QAPage|HowTo/i.test(t)) && p.questionHeadings < 2) add('aeo', POTENTIAL, 'Not optimised for AI answers', 'No FAQ structured data or question-style headings found.', ['Answer Engine Optimization (AEO)', 'Content optimization']);
  if (!p.jsRendered && p.wordCount < 250) add('thin-content', POTENTIAL, 'Very little text on homepage', `About ${p.wordCount} words of visible text.`, ['Content optimization', 'Copywriting']);
  if (p.imageCount >= 4 && p.imagesWithoutAlt / p.imageCount > 0.3) add('img-alt', POTENTIAL, 'Images missing alt text', `${p.imagesWithoutAlt} of ${p.imageCount} images have no alt attribute.`, ['Website optimization']);
  if (a.brokenLinks?.broken?.length) add('broken-links', CONFIRMED, 'Broken links', `${a.brokenLinks.broken.length} of ${a.brokenLinks.checked} checked links failed (e.g. ${a.brokenLinks.broken[0].url}).`, ['Website maintenance']);
  const year = new Date().getFullYear();
  if (p.copyrightYear && p.copyrightYear < year - 1) add('stale-footer', POTENTIAL, 'Website may not be maintained', `Footer copyright year is ${p.copyrightYear}.`, ['Website maintenance', 'Website backups and monitoring']);
  if (['fashion-retail', 'ecommerce'].includes(ctx.industryId) && !p.ecomSignals.length) add('no-ecommerce', POTENTIAL, 'No online shop detected', 'Retail business without visible online ordering.', ['E-commerce development']);
  if (!Object.keys(p.social).length) add('no-social-links', POTENTIAL, 'No social media links on website', 'No Instagram, Facebook, LinkedIn or TikTok links found.', ['Social media management']);
  return out;
}

/** Full audit of one website. Never throws: failures are recorded as results. */
async function auditWebsite(rawUrl, { pageSpeedKey = '', runPageSpeedTest = true, brokenLinkSample = 12, city = '', industryId = '' } = {}) {
  const url = normalizeUrl(rawUrl);
  const a = { status: 'Checked', url, domain: domainOf(url), checkedAt: new Date().toISOString(), availability: {}, https: {}, page: null, issues: [] };
  if (!url) return { ...a, status: 'Failed', availability: { ok: false, error: 'Invalid website URL' }, issues: [] };
  try {
    const { res, html } = await fetchPage(url);
    a.finalUrl = res.finalUrl; a.availability = { ok: res.status < 400 && !!html, httpStatus: res.status, responseMs: res.elapsedMs, redirects: res.redirects.length };
    if (res.status < 400 && !html) a.availability.error = 'Page returned no HTML content';
    a.https.usesHttps = res.finalUrl.startsWith('https:');
    if (a.availability.ok) a.page = analyzeHtml(html, res.finalUrl, { city });
  } catch (e) {
    a.availability = { ok: false, error: e.message };
    if (!(await internetOk())) {
      a.status = 'Failed';
      a.availability = { ok: false, networkProblem: true, error: 'Not checked: this computer could not reach the internet. ' + e.message };
    }
  }
  if (a.availability.ok) {
    const httpVersion = 'http://' + new URL(a.finalUrl).host + '/';
    if (a.https.usesHttps) {
      try { const r = await httpFetch(httpVersion, { api: 'website', guard: true, timeoutMs: 10000, retries: 0 }); a.https.httpRedirectsToHttps = r.finalUrl.startsWith('https:'); try { await r.body?.cancel(); } catch { /* ignore */ } }
      catch { a.https.httpRedirectsToHttps = null; }
    }
    const origin = new URL(a.finalUrl).origin;
    const sm = await headStatus(origin + '/sitemap.xml');
    a.sitemap = typeof sm === 'number' ? sm < 400 : null;
    if (a.page.contactPage) {
      try {
        const { html } = await fetchPage(a.page.contactPage);
        const c = analyzeHtml(html, a.page.contactPage, { city });
        a.contactPageForms = c.forms; a.contactPageAddress = c.addressOnSite || c.mapEmbed;
        a.page.emails = [...new Set([...a.page.emails, ...c.emails])].slice(0, 5);
        a.page.whatsapp ||= c.whatsapp; a.page.tel ||= c.tel;
        for (const [k, v] of Object.entries(c.social)) a.page.social[k] ||= v;
      } catch { /* contact page unreachable — not counted as an issue on its own */ }
    }
    if (brokenLinkSample > 0) {
      const sample = a.page.internalLinks.filter(l => l !== a.finalUrl && !/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip)$/i.test(l) && !/\/cdn-cgi\/|\/wp-json\/|\/xmlrpc\.php|\/feed\/?$|[?&](add-to-cart|replytocom)=/i.test(l)).slice(0, brokenLinkSample);
      const broken = [];
      for (const l of sample) { const st = await headStatus(l); if (typeof st === 'number' ? st >= 400 : true) broken.push({ url: l, status: st }); }
      a.brokenLinks = { checked: sample.length, broken };
    }
    if (runPageSpeedTest) {
      try { a.pagespeed = await runPageSpeed(a.finalUrl, pageSpeedKey); }
      catch (e) { a.pagespeed = { status: 'Failed', error: e.message, testedAt: new Date().toISOString() }; }
    } else a.pagespeed = { status: 'Not tested' };
  }
  a.issues = deriveIssues(a, { industryId });
  if (a.page) delete a.page.internalLinks; // keep the stored record lean
  return a;
}

module.exports = { auditWebsite, analyzeHtml, deriveIssues, runPageSpeed, CONFIRMED, POTENTIAL };
