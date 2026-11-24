'use strict';
// Shared helpers: safe outbound HTTP (retries, rate limits, SSRF guard), usage tracking, normalisation.
const dns = require('node:dns').promises;
const net = require('node:net');
const crypto = require('node:crypto');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const newId = (prefix = 'cmp') => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

class ApiError extends Error {
  constructor(message, { status = 0, api = '', retryable = false, code = '' } = {}) {
    super(message); this.status = status; this.api = api; this.retryable = retryable; this.code = code;
  }
}

// ---------- usage / cost monitoring ----------
let usageSink = null; // set by db layer: (api, ok) => void
function setUsageSink(fn) { usageSink = fn; }
// Spending guard: called before every outbound request; throws to stop a billable call before it is sent.
let budgetGuard = null;
function setBudgetGuard(fn) { budgetGuard = fn; }
function recordUsage(api, ok) { try { usageSink && usageSink(api, ok); } catch { /* never break a request on metrics */ } }

// ---------- per-API rate limiting ----------
const lastCall = new Map();
const minIntervalMs = { places: 250, pagespeed: 1200, rdap: 600, wayback: 800, website: 0 };
async function throttle(api) {
  const gap = minIntervalMs[api] ?? 0;
  if (!gap) return;
  const prev = lastCall.get(api) || 0;
  const wait = prev + gap - Date.now();
  lastCall.set(api, Math.max(Date.now(), prev + gap));
  if (wait > 0) await sleep(wait);
}

// ---------- SSRF guard: only public internet hosts ----------
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}
const usingProxy = () => !!(process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy));

// Is this computer online? Used so our own connection problems are never reported as a business's website problem.
let netCache = { at: 0, ok: true };
async function internetOk() {
  if (Date.now() - netCache.at < 60000) return netCache.ok;
  let ok = false;
  for (const u of ['https://www.google.com/generate_204', 'https://www.cloudflare.com/cdn-cgi/trace']) {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(8000) }); ok = r.status < 500; try { await r.body?.cancel(); } catch { /* ignore */ } if (ok) break; } catch { /* try next */ }
  }
  netCache = { at: Date.now(), ok };
  return ok;
}

async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new ApiError('Invalid URL: ' + raw); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new ApiError('Only http(s) URLs are allowed');
  if (u.username || u.password) throw new ApiError('URLs with credentials are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new ApiError('Private host not allowed');
  let addrs;
  try { addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }); }
  catch {
    // Behind an HTTP proxy the PC may not resolve names itself; the proxy does. Hostname rules above still apply.
    if (usingProxy()) return u;
    throw new ApiError('Domain does not resolve: ' + host, { api: 'website', code: 'DNS' });
  }
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new ApiError('Private network address not allowed');
  return u;
}

/**
 * fetch with timeout, retries (429/5xx/network) with exponential backoff, throttling and usage tracking.
 * opts: { api, timeoutMs, retries, guard (SSRF check), maxRedirects, ...fetchInit }
 */
async function httpFetch(url, opts = {}) {
  const { api = 'website', timeoutMs = 20000, retries = 2, guard = false, maxRedirects = 5, ...init } = opts;
  let attempt = 0;
  for (;;) {
    if (budgetGuard) budgetGuard(api); // throws ApiError(code 'BUDGET') — nothing is sent or counted
    await throttle(api);
    const started = Date.now();
    try {
      let target = url, res, redirects = [];
      for (let hop = 0; ; hop++) {
        if (guard) await assertPublicUrl(target);
        res = await fetch(target, { ...init, redirect: guard ? 'manual' : 'follow', signal: AbortSignal.timeout(timeoutMs),
          headers: { 'user-agent': 'CanvassLeadFinder/1.0 (+business website audit)', ...(init.headers || {}) } });
        if (guard && res.status >= 300 && res.status < 400 && res.headers.get('location') && hop < maxRedirects) {
          const next = new URL(res.headers.get('location'), target).href;
          redirects.push({ from: target, to: next, status: res.status });
          try { await res.body?.cancel(); } catch { /* ignore */ }
          target = next; continue;
        }
        break;
      }
      const elapsedMs = Date.now() - started;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        attempt++; recordUsage(api, false);
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        await sleep(retryAfter > 0 ? Math.min(retryAfter, 30000) : 1000 * 2 ** attempt);
        continue;
      }
      recordUsage(api, res.ok);
      res.finalUrl = res.url || target; res.elapsedMs = elapsedMs; res.redirects = redirects;
      return res;
    } catch (e) {
      const retryable = !(e instanceof ApiError) && attempt < retries;
      recordUsage(api, false);
      if (retryable) { attempt++; await sleep(1000 * 2 ** attempt); continue; }
      if (e instanceof ApiError) throw e;
      throw new ApiError((e.name === 'TimeoutError' ? 'Timed out' : 'Network error') + ' contacting ' + safeHost(url) + ': ' + (e.cause?.code || e.message), { api, retryable: true });
    }
  }
}
function safeHost(u) { try { return new URL(u).hostname; } catch { return 'remote host'; } }

async function readTextLimited(res, maxBytes = 2_500_000) {
  const reader = res.body?.getReader(); if (!reader) return '';
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length; chunks.push(value);
    if (total > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } break; }
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ---------- normalisation for duplicate detection ----------
function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
    if (!u.hostname.includes('.')) return '';
    return u.href;
  } catch { return ''; }
}
const SOCIAL_HOSTS = /(^|\.)(facebook|instagram|linkedin|tiktok|twitter|x|youtube|wa|whatsapp|google|goo|linktr|bit)\.(com|ee|me|gl|ly)$/i;
function domainOf(raw) {
  const u = normalizeUrl(raw); if (!u) return '';
  return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
}
function isSocialOrPlatformUrl(raw) { const d = domainOf(raw); return !!d && SOCIAL_HOSTS.test(d); }
function registrableDomain(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const sld = parts[parts.length - 2];
  // co.uk, com.au, co.ae, net.ae, org.ae, ...
  if (['co', 'com', 'net', 'org', 'gov', 'ac', 'edu', 'sch', 'ltd'].includes(sld) && parts[parts.length - 1].length === 2) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}
const normName = s => String(s || '').toLowerCase()
  .replace(/&/g, ' and ').replace(/\b(llc|l\.l\.c|fze|fzco|fz llc|fzc|est|establishment|trading|co|company|ltd|limited|inc|plc|pvt|llp|dmcc|sole proprietorship)\b\.?/g, ' ')
  .replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim().replace(/\s+/g, ' ');
const normPhone = s => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-9) : ''; };
const normPlace = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function nameSimilarity(a, b) {
  const A = new Set(normName(a).split(' ').filter(Boolean)), B = new Set(normName(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(A.size, B.size);
}

const yearsBetween = (fromIso, to = new Date()) => (to - new Date(fromIso)) / (365.2425 * 86400000);
const monthsBetween = (fromIso, to = new Date()) => (to - new Date(fromIso)) / (30.436875 * 86400000);
const isValidDate = s => !!s && !Number.isNaN(new Date(s).getTime());

module.exports = { setBudgetGuard, internetOk, usingProxy, sleep, nowIso, newId, ApiError, httpFetch, readTextLimited, assertPublicUrl, isPrivateIp, setUsageSink,
  recordUsage, normalizeUrl, domainOf, registrableDomain, isSocialOrPlatformUrl, normName, normPhone, normPlace,
  nameSimilarity, yearsBetween, monthsBetween, isValidDate };
