<?php
/* Lead Finder · website audit. Every score or issue here comes from a request this engine actually made. */
declare(strict_types=1);

const LF_CONFIRMED = 'Confirmed Issue';
const LF_POTENTIAL = 'Potential Improvement';

function lf_html_decode(string $s): string {
  $s = str_replace(['&amp;', '&lt;', '&gt;', '&quot;', '&#039;', '&#39;', '&apos;', '&nbsp;'], ['&', '<', '>', '"', "'", "'", "'", ' '], $s);
  return preg_replace_callback('/&#(\d+);/', fn($m) => mb_chr((int) $m[1]) ?: '', $s);
}
function lf_attr(string $tag, string $name): ?string {
  if (preg_match('/\b' . $name . '\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>]+))/i', $tag, $m)) return lf_html_decode($m[2] !== '' ? $m[2] : (($m[3] ?? '') !== '' ? $m[3] : ($m[4] ?? '')));
  return null;
}
function lf_meta_content(string $html, string $key): ?string {
  preg_match_all('/<meta\b[^>]*>/i', $html, $mm);
  foreach ($mm[0] as $tag) { $n = strtolower((lf_attr($tag, 'name') ?? '') ?: (lf_attr($tag, 'property') ?? '')); if ($n === $key) return trim(lf_attr($tag, 'content') ?? ''); }
  return null;
}
function lf_visible_text(string $html): string {
  $t = preg_replace('/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/i', ' ', $html);
  $t = preg_replace('/<!--[\s\S]*?-->/', ' ', $t); $t = preg_replace('/<[^>]+>/', ' ', $t);
  return trim(preg_replace('/\s+/u', ' ', lf_html_decode($t)));
}
function lf_url_parts(string $href, string $base): ?array {
  $href = trim($href); if ($href === '') $href = $base;
  $abs = lf_resolve_url($href, $base); $u = parse_url($abs); if (!$u || empty($u['scheme'])) return null;
  return ['url' => $abs, 'protocol' => strtolower($u['scheme']) . ':', 'host' => strtolower($u['host'] ?? '')];
}

/** Pure HTML analysis — unit-tested without network. */
function lf_analyze_html(string $html, string $pageUrl, array $ctx = []): array {
  $host = lf_registrable_domain(parse_url($pageUrl, PHP_URL_HOST) ?: '');
  $title = preg_match('/<title[^>]*>([\s\S]*?)<\/title>/i', $html, $m) ? trim(preg_replace('/\s+/', ' ', lf_html_decode($m[1]))) : '';
  preg_match_all('/<h1\b[\s\S]*?<\/h1>/i', $html, $hm); $h1s = array_values(array_filter(array_map('lf_visible_text', $hm[0]), 'strlen'));
  preg_match_all('/<a\b([^>]*)>([\s\S]*?)<\/a>/i', $html, $am, PREG_SET_ORDER);
  $links = []; $internal = [];
  foreach ($am as $a) {
    $href = lf_attr($a[1], 'href') ?? ''; $text = mb_substr(lf_visible_text($a[2]), 0, 80);
    $p = lf_url_parts($href, $pageUrl); if (!$p) continue;
    $links[] = ['href' => $href, 'text' => $text] + $p;
    if (in_array($p['protocol'], ['http:', 'https:'], true) && lf_registrable_domain($p['host']) === $host) $internal[preg_replace('/#.*$/', '', $p['url'])] = true;
  }
  $text = lf_visible_text($html); $words = $text === '' ? 0 : count(explode(' ', $text));
  $ldTypes = [];
  preg_match_all('/<script[^>]+type\s*=\s*["\']application\/ld\+json["\'][^>]*>([\s\S]*?)<\/script>/i', $html, $lm);
  foreach ($lm[1] as $j) {
    $o = json_decode(trim($j), true);
    if ($o === null) { $ldTypes[] = '(invalid JSON-LD)'; continue; }
    $walk = function ($o) use (&$walk, &$ldTypes) {
      if (!is_array($o)) return;
      if (array_is_list($o)) { foreach ($o as $x) $walk($x); return; }
      if (isset($o['@type'])) foreach ((array) $o['@type'] as $t) $ldTypes[] = (string) $t;
      if (isset($o['@graph'])) $walk($o['@graph']);
    };
    $walk($o);
  }
  preg_match_all('/<img\b[^>]*>/i', $html, $im); $imgs = $im[0];
  $noAlt = count(array_filter($imgs, fn($t) => lf_attr($t, 'alt') === null));
  preg_match_all('/<form\b[\s\S]*?<\/form>/i', $html, $fm); $forms = array_filter($fm[0], fn($f) => preg_match('/<(input|textarea)\b/i', $f));
  $emails = [];
  foreach ($links as $l) if ($l['protocol'] === 'mailto:') $emails[strtolower(rawurldecode(explode('?', substr($l['url'], 7))[0]))] = true;
  if (preg_match_all('/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i', $text, $em)) foreach ($em[0] as $e) $emails[strtolower($e)] = true;
  // Cloudflare "email protection" hides addresses as XOR-encoded hex; decode them so public emails are still found.
  if (preg_match_all('/data-cfemail\s*=\s*["\']([0-9a-f]+)["\']|\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/i', $html, $cm, PREG_SET_ORDER)) foreach ($cm as $c) {
    $hex = ($c[1] ?? '') !== '' ? $c[1] : ($c[2] ?? ''); if (strlen($hex) < 4) continue;
    $key = hexdec(substr($hex, 0, 2)); $e = '';
    for ($i = 2; $i + 1 < strlen($hex) + 1; $i += 2) { $pair = substr($hex, $i, 2); if (strlen($pair) < 2) break; $e .= chr(hexdec($pair) ^ $key); }
    if (preg_match('/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i', $e)) $emails[strtolower($e)] = true;
  }
  $real = array_values(array_filter(array_keys($emails), fn($e) => !preg_match('/\.(png|jpe?g|gif|webp|svg)$/i', $e) && !preg_match('/(example\.|sentry|wixpress|domain\.com|email\.com)/i', $e)));
  // ".example" addresses are reserved test domains, but the filter above matches "example." — keep parity with v1.0
  $social = [];
  foreach ($links as $l) {
    $h = preg_replace('/^www\./', '', $l['host']);
    foreach (['instagram' => '/instagram\.com$/', 'facebook' => '/(facebook|fb)\.com$/', 'linkedin' => '/linkedin\.com$/', 'tiktok' => '/tiktok\.com$/', 'x' => '/(twitter|x)\.com$/', 'youtube' => '/youtube\.com$/'] as $k => $re)
      if (preg_match($re, $h) && empty($social[$k]) && !preg_match('/sharer|share\?|intent\/tweet/i', $l['url'])) $social[$k] = $l['url'];
  }
  $whatsapp = false; foreach ($links as $l) if (preg_match('#wa\.me|api\.whatsapp\.com|whatsapp://|web\.whatsapp\.com#i', $l['url'])) $whatsapp = true;
  if (!$whatsapp && preg_match('#wa\.me/|api\.whatsapp\.com#i', $html)) $whatsapp = true;
  $ctaRe = '/(get (a )?(free )?quote|request (a )?quote|contact us|book( now| an appointment| a call)?|call (us|now)|enquire|inquire|get started|order now|buy now|shop now|schedule|free consultation|whatsapp us|send (an )?enquiry)/i';
  preg_match_all('/<button\b[\s\S]*?<\/button>/i', $html, $bm);
  $ctas = [];
  foreach (array_merge(array_column($links, 'text'), array_map('lf_visible_text', $bm[0])) as $t) if ($t !== '' && preg_match($ctaRe, $t)) $ctas[mb_substr($t, 0, 40)] = true;
  $ctas = array_slice(array_keys($ctas), 0, 8);
  $contact = null;
  foreach ($links as $l) if (preg_match('/contact|enquir|inquir|get-in-touch|reach-us/i', $l['url'] . ' ' . $l['text']) && $l['host'] && lf_registrable_domain($l['host']) === $host) { $contact = $l['url']; break; }
  $years = [];
  if (preg_match_all('/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/iu', $text, $ym)) foreach ($ym[1] as $y) { $y = (int) $y; if ($y > 1995 && $y <= (int) gmdate('Y') + 1) $years[] = $y; }
  $eco = [];
  if (preg_match('/add[ -]to[ -]cart|add to bag/i', $text)) $eco[] = 'Add to cart button';
  if (preg_match('/woocommerce/i', $html)) $eco[] = 'WooCommerce';
  if (preg_match('/cdn\.shopify\.com|Shopify\.theme/i', $html)) $eco[] = 'Shopify';
  if (preg_match('/\/cart\b|\/checkout\b/i', $html)) $eco[] = 'Cart/checkout links';
  if (preg_match('/magento|bigcommerce|opencart|prestashop/i', $html)) $eco[] = 'E-commerce platform';
  $lower = mb_strtolower($text);
  $addressOnSite = (!empty($ctx['city']) && str_contains($lower, mb_strtolower($ctx['city']))) || (bool) preg_match('/\b(p\.?\s?o\.?\s?box|street|road|building|floor|office\s?\d+|suite)\b/i', $text);
  $jsRendered = $words < 80 && (bool) preg_match('/<div[^>]+id=["\'](root|app|__next|__nuxt)["\'][^>]*>\s*<\/div>|__NEXT_DATA__|ng-version|data-reactroot/i', $html);
  $canonical = null; if (preg_match('/<link\b[^>]*rel\s*=\s*["\']?canonical[^>]*>/i', $html, $cn)) $canonical = lf_attr($cn[0], 'href');
  preg_match_all('/<h[2-4]\b[^>]*>[^<]*\?\s*<\/h[2-4]>/i', $html, $qh);
  return [
    'title' => $title, 'metaDescription' => lf_meta_content($html, 'description'), 'ogTitle' => lf_meta_content($html, 'og:title'),
    'viewport' => (bool) lf_meta_content($html, 'viewport'), 'robots' => lf_meta_content($html, 'robots') ?? '', 'lang' => preg_match('/<html[^>]*\blang\s*=\s*["\']?([\w-]+)/i', $html, $lg) ? $lg[1] : '',
    'canonical' => $canonical, 'h1s' => $h1s, 'wordCount' => $words, 'ldTypes' => $ldTypes, 'imageCount' => count($imgs), 'imagesWithoutAlt' => $noAlt, 'forms' => count($forms),
    'emails' => array_slice($real, 0, 5), 'social' => $social, 'whatsapp' => $whatsapp,
    'tel' => (bool) array_filter($links, fn($l) => $l['protocol'] === 'tel:'), 'mailto' => (bool) array_filter($links, fn($l) => $l['protocol'] === 'mailto:'),
    'ctas' => $ctas, 'contactPage' => $contact, 'internalLinks' => array_slice(array_keys($internal), 0, 200),
    'copyrightYear' => $years ? max($years) : null, 'generator' => lf_meta_content($html, 'generator') ?? '', 'ecomSignals' => $eco,
    'mapEmbed' => (bool) preg_match('/google\.[a-z.]+\/maps\/embed|maps\.google\.[a-z.]+.*output=embed/i', $html), 'addressOnSite' => $addressOnSite, 'jsRendered' => $jsRendered,
    'questionHeadings' => count($qh[0]),
  ];
}

function lf_fetch_page(string $url): array {
  $res = LfHttp::fetch($url, ['api' => 'website', 'guard' => true, 'timeout' => 20, 'retries' => 1, 'headers' => ['accept' => 'text/html,application/xhtml+xml']]);
  $type = $res['headers']['content-type'] ?? '';
  $html = ($type === '' || preg_match('/html|xml|text\/plain/i', $type)) ? $res['body'] : '';
  return [$res, $html];
}
function lf_head_status(string $url) {
  try {
    $res = LfHttp::fetch($url, ['api' => 'website', 'guard' => true, 'method' => 'HEAD', 'timeout' => 12, 'retries' => 0]);
    if (in_array($res['status'], [405, 403, 501], true)) $res = LfHttp::fetch($url, ['api' => 'website', 'guard' => true, 'timeout' => 12, 'retries' => 0, 'maxBytes' => 65536]);
    return $res['status'];
  } catch (Throwable $e) { return 'error: ' . mb_substr($e->getMessage(), 0, 80); }
}

function lf_run_pagespeed(string $url, string $key): array {
  $q = 'url=' . rawurlencode($url) . '&strategy=mobile';
  foreach (['performance', 'seo', 'accessibility', 'best-practices'] as $c) $q .= '&category=' . $c;
  if ($key !== '') $q .= '&key=' . rawurlencode($key);
  $res = LfHttp::fetch('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?' . $q, ['api' => 'pagespeed', 'timeout' => 90, 'retries' => 1]);
  $data = json_decode($res['body'], true) ?: [];
  if (!$res['ok'] || empty($data['lighthouseResult'])) throw new ApiError('PageSpeed: ' . ($data['error']['message'] ?? 'HTTP ' . $res['status']), ['status' => $res['status'], 'api' => 'pagespeed']);
  $cat = $data['lighthouseResult']['categories'] ?? []; $au = $data['lighthouseResult']['audits'] ?? [];
  $sc = fn($k) => is_numeric($cat[$k]['score'] ?? null) ? (int) round($cat[$k]['score'] * 100) : null;
  return ['status' => 'Tested', 'strategy' => 'mobile', 'testedAt' => lf_now_iso(), 'source' => 'Google PageSpeed Insights (Lighthouse)',
    'performance' => $sc('performance'), 'seo' => $sc('seo'), 'accessibility' => $sc('accessibility'), 'bestPractices' => $sc('best-practices'),
    'lcp' => $au['largest-contentful-paint']['displayValue'] ?? '', 'cls' => $au['cumulative-layout-shift']['displayValue'] ?? '', 'tbt' => $au['total-blocking-time']['displayValue'] ?? ''];
}

/** Turn measurements into issues. Confirmed (measured) or potential (opportunity), plus the services they map to. */
function lf_derive_issues(array $a, array $ctx = []): array {
  $out = [];
  $add = function ($id, $status, $title, $detail, $services) use (&$out, $a) { $out[] = ['id' => $id, 'area' => 'website', 'status' => $status, 'title' => $title, 'detail' => $detail, 'services' => $services, 'evidence' => ($a['finalUrl'] ?? '') ?: ($a['url'] ?? ''), 'checkedAt' => $a['checkedAt'] ?? null]; };
  $av = $a['availability'] ?? [];
  if (!empty($av['networkProblem'])) return $out;      // our connection failed — say nothing about the business's site
  if (empty($av['ok'])) { $add('site-down', LF_CONFIRMED, 'Website is not loading', ($av['error'] ?? '') ?: 'Server returned HTTP ' . ($av['httpStatus'] ?? '?'), ['Website redesign', 'Website maintenance', 'Domain and hosting support']); return $out; }
  $p = $a['page']; $soft = !empty($p['jsRendered']) ? LF_POTENTIAL : LF_CONFIRMED;
  if (empty($a['https']['usesHttps'])) $add('no-https', LF_CONFIRMED, 'Website does not use HTTPS', 'Final page was served over plain HTTP.', ['Domain and hosting support', 'Website maintenance']);
  elseif (($a['https']['httpRedirectsToHttps'] ?? null) === false) $add('http-no-redirect', LF_POTENTIAL, 'HTTP version does not redirect to HTTPS', 'Visitors typing the plain address may land on an insecure page.', ['Domain and hosting support']);
  if (empty($p['viewport'])) $add('no-viewport', LF_CONFIRMED, 'Not set up for mobile screens', 'No responsive viewport meta tag was found on the homepage.', ['Website redesign', 'Website optimization']);
  if (($av['responseMs'] ?? 0) > 3000) $add('slow-response', LF_POTENTIAL, 'Slow server response', sprintf('Homepage took %.1fs to respond in one measurement.', $av['responseMs'] / 1000), ['Website optimization', 'Domain and hosting support']);
  $ps = $a['pagespeed'] ?? null;
  if (($ps['status'] ?? '') === 'Tested') {
    if (($ps['performance'] ?? null) !== null && $ps['performance'] < 50) $add('ps-performance', LF_CONFIRMED, 'Poor mobile performance', "PageSpeed mobile performance {$ps['performance']}/100 (LCP " . (($ps['lcp'] ?? '') ?: 'n/a') . ').', ['Website optimization']);
    elseif (($ps['performance'] ?? null) !== null && $ps['performance'] < 80) $add('ps-performance', LF_POTENTIAL, 'Mobile performance can improve', "PageSpeed mobile performance {$ps['performance']}/100.", ['Website optimization']);
    if (($ps['seo'] ?? null) !== null && $ps['seo'] < 80) $add('ps-seo', LF_CONFIRMED, 'Technical SEO score below 80', "Lighthouse SEO {$ps['seo']}/100.", ['Technical SEO']);
    if (($ps['accessibility'] ?? null) !== null && $ps['accessibility'] < 80) $add('ps-a11y', LF_POTENTIAL, 'Accessibility can improve', "Lighthouse accessibility {$ps['accessibility']}/100. Review before proposing a redesign.", ['Website design']);
    if (($ps['bestPractices'] ?? null) !== null && $ps['bestPractices'] < 80) $add('ps-bp', LF_POTENTIAL, 'Best-practice issues found', "Lighthouse best practices {$ps['bestPractices']}/100.", ['Website maintenance']);
  }
  $title = (string) ($p['title'] ?? ''); $tl = mb_strlen($title);
  if ($title === '') $add('no-title', $soft, 'Missing page title', 'Homepage has no <title>.', ['Technical SEO']);
  elseif ($tl < 15 || $tl > 65) $add('title-length', LF_POTENTIAL, 'Page title length is not optimal', "Title is $tl characters: \"" . mb_substr($title, 0, 70) . '"', ['Technical SEO', 'Content optimization']);
  if (empty($p['metaDescription'])) $add('no-meta-desc', $soft, 'Missing meta description', 'Search results will show auto-generated text.', ['Technical SEO', 'Copywriting']);
  $h1 = count($p['h1s'] ?? []);
  if (!$h1) $add('no-h1', $soft, 'No main heading (H1)', 'Homepage has no H1 heading.', ['Technical SEO', 'Content optimization']);
  elseif ($h1 > 1) $add('multi-h1', LF_POTENTIAL, 'Multiple H1 headings', "$h1 H1 headings on the homepage.", ['Technical SEO']);
  if (preg_match('/noindex/i', (string) ($p['robots'] ?? ''))) $add('noindex', LF_CONFIRMED, 'Homepage blocks search engines', 'robots meta tag contains "noindex".', ['Technical SEO']);
  if (empty($p['canonical'])) $add('no-canonical', LF_POTENTIAL, 'No canonical URL', 'Canonical link tag not found.', ['Technical SEO']);
  if (($a['sitemap'] ?? null) === false) $add('no-sitemap', LF_POTENTIAL, 'No sitemap.xml found', '/sitemap.xml did not return a page.', ['Technical SEO']);
  $hasEnquiry = ($p['forms'] ?? 0) > 0 || ($a['contactPageForms'] ?? 0) > 0;
  if (empty($p['contactPage']) && !$hasEnquiry && empty($p['tel']) && empty($p['whatsapp'])) $add('no-enquiry', $soft, 'No clear way to enquire', 'No contact page, enquiry form, phone link or WhatsApp link found.', ['Website redesign', 'Website integrations']);
  elseif (!$hasEnquiry) $add('no-form', LF_POTENTIAL, 'No enquiry form found', 'Checked the homepage' . (!empty($p['contactPage']) ? ' and contact page.' : '.'), ['Website integrations']);
  if (empty($p['whatsapp'])) $add('no-whatsapp', LF_POTENTIAL, 'No WhatsApp integration', 'No WhatsApp chat link found on the homepage.', ['Website integrations']);
  if (empty($p['ctas'])) $add('no-cta', LF_POTENTIAL, 'No clear call-to-action', 'No "Get a quote", "Book", "Contact us" style buttons detected.', ['Website redesign', 'Copywriting']);
  $ld = $p['ldTypes'] ?? [];
  $hasLocal = (bool) array_filter($ld, fn($t) => preg_match('/LocalBusiness|Organization|Store|Restaurant|MedicalClinic|Dentist|BeautySalon|ProfessionalService|AutoRepair|RealEstateAgent/i', $t));
  if (!$hasLocal) $add('no-local-schema', LF_POTENTIAL, 'No business structured data', 'No LocalBusiness/Organization schema found.', ['Local SEO', 'Answer Engine Optimization (AEO)']);
  if (empty($p['addressOnSite']) && empty($p['mapEmbed']) && empty($a['contactPageAddress'])) $add('no-address', LF_POTENTIAL, 'Location not shown on website', 'No address or map found on homepage' . (!empty($p['contactPage']) ? ' or contact page.' : '.'), ['Local SEO']);
  if (!array_filter($ld, fn($t) => preg_match('/FAQPage|QAPage|HowTo/i', $t)) && ($p['questionHeadings'] ?? 0) < 2) $add('aeo', LF_POTENTIAL, 'Not optimised for AI answers', 'No FAQ structured data or question-style headings found.', ['Answer Engine Optimization (AEO)', 'Content optimization']);
  if (empty($p['jsRendered']) && ($p['wordCount'] ?? 0) < 250) $add('thin-content', LF_POTENTIAL, 'Very little text on homepage', 'About ' . ($p['wordCount'] ?? 0) . ' words of visible text.', ['Content optimization', 'Copywriting']);
  if (($p['imageCount'] ?? 0) >= 4 && $p['imagesWithoutAlt'] / $p['imageCount'] > 0.3) $add('img-alt', LF_POTENTIAL, 'Images missing alt text', "{$p['imagesWithoutAlt']} of {$p['imageCount']} images have no alt attribute.", ['Website optimization']);
  $broken = $a['brokenLinks']['broken'] ?? [];
  if ($broken) $add('broken-links', LF_CONFIRMED, 'Broken links', count($broken) . " of {$a['brokenLinks']['checked']} checked links failed (e.g. {$broken[0]['url']}).", ['Website maintenance']);
  $year = (int) gmdate('Y');
  if (!empty($p['copyrightYear']) && $p['copyrightYear'] < $year - 1) $add('stale-footer', LF_POTENTIAL, 'Website may not be maintained', "Footer copyright year is {$p['copyrightYear']}.", ['Website maintenance', 'Website backups and monitoring']);
  if (in_array($ctx['industryId'] ?? '', ['fashion-retail', 'ecommerce'], true) && empty($p['ecomSignals'])) $add('no-ecommerce', LF_POTENTIAL, 'No online shop detected', 'Retail business without visible online ordering.', ['E-commerce development']);
  if (empty($p['social'])) $add('no-social-links', LF_POTENTIAL, 'No social media links on website', 'No Instagram, Facebook, LinkedIn or TikTok links found.', ['Social media management']);
  return $out;
}

/** Full audit of one website. Never throws (except the free-tier guard): failures are recorded as results. */
function lf_audit_website(string $rawUrl, array $o = []): array {
  $url = lf_normalize_url($rawUrl);
  $a = ['status' => 'Checked', 'url' => $url, 'domain' => lf_domain_of($url), 'checkedAt' => lf_now_iso(), 'availability' => [], 'https' => [], 'page' => null, 'issues' => []];
  if ($url === '') return array_merge($a, ['status' => 'Failed', 'availability' => ['ok' => false, 'error' => 'Invalid website URL'], 'issues' => []]);
  $city = $o['city'] ?? '';
  try {
    [$res, $html] = lf_fetch_page($url);
    $a['finalUrl'] = $res['finalUrl'];
    $a['availability'] = ['ok' => $res['status'] < 400 && $html !== '', 'httpStatus' => $res['status'], 'responseMs' => $res['elapsedMs'], 'redirects' => count($res['redirects'])];
    if ($res['status'] < 400 && $html === '') $a['availability']['error'] = 'Page returned no HTML content';
    $a['https']['usesHttps'] = str_starts_with($res['finalUrl'], 'https:');
    if ($a['availability']['ok']) $a['page'] = lf_analyze_html($html, $res['finalUrl'], ['city' => $city]);
  } catch (Throwable $e) {
    $a['availability'] = ['ok' => false, 'error' => $e->getMessage()];
    if (!lf_internet_ok()) { $a['status'] = 'Failed'; $a['availability'] = ['ok' => false, 'networkProblem' => true, 'error' => 'Not checked: the Canvass server could not reach the internet. ' . $e->getMessage()]; }
  }
  if (!empty($a['availability']['ok'])) {
    $u = parse_url($a['finalUrl']); $hostPort = ($u['host'] ?? '') . (isset($u['port']) ? ':' . $u['port'] : '');
    if ($a['https']['usesHttps']) {
      try { $r = LfHttp::fetch('http://' . $hostPort . '/', ['api' => 'website', 'guard' => true, 'timeout' => 10, 'retries' => 0, 'maxBytes' => 65536]); $last = end($r['redirects']); $a['https']['httpRedirectsToHttps'] = str_starts_with($last ? $last['to'] : $r['finalUrl'], 'https:'); }
      catch (Throwable $e) { $a['https']['httpRedirectsToHttps'] = null; }
    }
    $origin = ($u['scheme'] ?? 'https') . '://' . $hostPort;
    $sm = lf_head_status($origin . '/sitemap.xml'); $a['sitemap'] = is_int($sm) ? $sm < 400 : null;
    if (!empty($a['page']['contactPage'])) {
      try {
        [, $chtml] = lf_fetch_page($a['page']['contactPage']); $c = lf_analyze_html($chtml, $a['page']['contactPage'], ['city' => $city]);
        $a['contactPageForms'] = $c['forms']; $a['contactPageAddress'] = $c['addressOnSite'] || $c['mapEmbed'];
        $a['page']['emails'] = array_slice(array_values(array_unique(array_merge($a['page']['emails'], $c['emails']))), 0, 5);
        $a['page']['whatsapp'] = $a['page']['whatsapp'] || $c['whatsapp']; $a['page']['tel'] = $a['page']['tel'] || $c['tel'];
        foreach ($c['social'] as $k => $v) if (empty($a['page']['social'][$k])) $a['page']['social'][$k] = $v;
      } catch (Throwable $e) { /* contact page unreachable — not counted as an issue on its own */ }
    }
    $sample = (int) ($o['brokenLinkSample'] ?? 12);
    if ($sample > 0) {
      $list = array_slice(array_values(array_filter($a['page']['internalLinks'], fn($l) => $l !== $a['finalUrl'] && !preg_match('/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip)$/i', $l) && !preg_match('#/cdn-cgi/|/wp-json/|/xmlrpc\.php|/feed/?$|[?&](add-to-cart|replytocom)=#i', $l))), 0, $sample);
      $broken = [];
      foreach ($list as $l) { $st = lf_head_status($l); if (is_int($st) ? $st >= 400 : true) $broken[] = ['url' => $l, 'status' => $st]; }
      $a['brokenLinks'] = ['checked' => count($list), 'broken' => $broken];
    }
    if (!empty($o['runPageSpeed'])) {
      try { $a['pagespeed'] = lf_run_pagespeed($a['finalUrl'], (string) ($o['pageSpeedKey'] ?? '')); }
      catch (Throwable $e) { $a['pagespeed'] = ['status' => 'Failed', 'error' => $e->getMessage(), 'testedAt' => lf_now_iso()]; }
    } else $a['pagespeed'] = ['status' => 'Not tested'];
  }
  $a['issues'] = lf_derive_issues($a, ['industryId' => $o['industryId'] ?? '']);
  if ($a['page']) unset($a['page']['internalLinks']);     // keep the stored record lean
  return $a;
}
