<?php
/* Website HTML analysis, issue derivation, Google Business audit, review analysis, pitches. */
$S = lf_defaults(); $Y = (int) gmdate('Y');
$GOOD = '<!doctype html><html lang="en"><head><title>Olive Interiors | Fit-out company in Dubai</title>
<meta name="viewport" content="width=device-width"><meta name="description" content="Interior fit-out in Dubai.">
<link rel="canonical" href="https://olive.example/"><script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Olive"}</script>
<script type="application/ld+json">{"@type":"FAQPage"}</script></head><body><h1>Interior fit-out in Dubai</h1>
<a href="/contact">Contact us</a><a href="https://wa.me/971500000000">WhatsApp us</a><a href="tel:+97140000000">Call</a>
<a href="mailto:hello@olive.example">Email</a><a href="https://instagram.com/olive">IG</a>
<form><input type="email"><textarea></textarea></form><p>Office 4, Al Quoz, Dubai. ' . str_repeat('word ', 300) . '</p>
<a href="/cdn-cgi/l/email-protection#4e262b22222e29213d27">x</a>
<footer>© 2021-' . $Y . ' Olive</footer></body></html>';
$audit = fn($page, $extra = []) => array_merge(['url' => 'https://x.example/', 'finalUrl' => 'https://x.example/', 'checkedAt' => lf_now_iso(), 'availability' => ['ok' => true, 'httpStatus' => 200, 'responseMs' => 500], 'https' => ['usesHttps' => true, 'httpRedirectsToHttps' => true], 'sitemap' => true, 'brokenLinks' => ['checked' => 5, 'broken' => []], 'pagespeed' => ['status' => 'Not tested'], 'page' => $page], $extra);
$ids = fn($issues, $st = 'Confirmed Issue') => array_column(array_filter($issues, fn($i) => $i['status'] === $st), 'id');

test('HTML analysis extracts real on-page facts', function () use ($GOOD, $Y) {
  $p = lf_analyze_html($GOOD, 'https://olive.example/', ['city' => 'Dubai']);
  eq($p['viewport'], true); eq(count($p['h1s']), 1); eq($p['forms'], 1); eq($p['whatsapp'], true); eq($p['tel'], true); ok_(in_array('hello@olive.example', $p['emails'], true), 'email found');
  ok_(in_array('LocalBusiness', $p['ldTypes'], true)); eq($p['addressOnSite'], true); eq($p['contactPage'], 'https://olive.example/contact'); ok_(!empty($p['social']['instagram']));
  eq($p['copyrightYear'], $Y); ok_(count($p['ctas']) >= 1);
});
test('Cloudflare-protected emails are decoded', function () {
  $enc = '4e'; foreach (str_split('hello@go.ai') as $ch) $enc .= sprintf('%02x', ord($ch) ^ 0x4e);
  ok_(in_array('hello@go.ai', lf_analyze_html("<a href=\"/cdn-cgi/l/email-protection#$enc\">x</a>", 'https://x.example/')['emails'], true));
});
test('a well-built site has no confirmed issues', fn() => eq($ids(lf_derive_issues($audit(lf_analyze_html($GOOD, 'https://olive.example/', ['city' => 'Dubai'])))), []));
test('measured problems become confirmed issues', function () use ($audit, $ids) {
  $bad = lf_analyze_html('<html><body><p>hi</p></body></html>', 'http://x.example/');
  $issues = lf_derive_issues($audit($bad, ['https' => ['usesHttps' => false], 'brokenLinks' => ['checked' => 3, 'broken' => [['url' => 'https://x.example/a', 'status' => 404]]]]));
  foreach (['no-https', 'no-viewport', 'no-title', 'no-meta-desc', 'no-h1', 'broken-links'] as $id) ok_(in_array($id, $ids($issues), true), $id);
  foreach ($issues as $i) ok_(count($i['services']) > 0, 'every issue maps to services');
});
test('PageSpeed scores are only used when the test actually ran', function () use ($GOOD, $audit) {
  $page = lf_analyze_html($GOOD, 'https://olive.example/', ['city' => 'Dubai']);
  eq(count(array_filter(lf_derive_issues($audit($page, ['pagespeed' => ['status' => 'Failed', 'error' => 'quota']])), fn($i) => str_starts_with($i['id'], 'ps-'))), 0);
  ok_((bool) array_filter(lf_derive_issues($audit($page, ['pagespeed' => ['status' => 'Tested', 'performance' => 30, 'seo' => 95, 'accessibility' => 95, 'bestPractices' => 95]])), fn($i) => $i['id'] === 'ps-performance' && $i['status'] === 'Confirmed Issue'));
});
test('our own network failure is never reported as the business’s problem', function () {
  eq(lf_derive_issues(['availability' => ['ok' => false, 'networkProblem' => true, 'error' => 'offline']]), []);
  eq(lf_derive_issues(['availability' => ['ok' => false, 'httpStatus' => 500], 'url' => 'https://x'])[0]['id'], 'site-down');
});
test('JavaScript-rendered sites get potential (not confirmed) content issues', function () use ($audit, $ids) {
  $p = lf_analyze_html('<html><body><div id="root"></div><script src="app.js"></script></body></html>', 'https://spa.example/');
  eq($p['jsRendered'], true); $c = $ids(lf_derive_issues($audit($p))); ok_(!in_array('no-h1', $c, true) && !in_array('no-title', $c, true));
});
$g = fn($over = []) => array_merge(['placeId' => 'p', 'fetchedAt' => lf_now_iso(), 'formattedAddress' => 'Shop 4, Al Wasl Road, Dubai', 'addressComponents' => [['types' => ['route']]], 'location' => ['latitude' => 1, 'longitude' => 2], 'googleMapsUri' => 'https://maps.google.com/?cid=1',
  'websiteUri' => 'https://x.example', 'nationalPhoneNumber' => '04', 'regularOpeningHours' => ['weekdayDescriptions' => ['Mon']], 'editorialSummary' => 'Nice', 'primaryType' => 'interior_designer', 'types' => ['interior_designer', 'furniture_store'],
  'photoCount' => 10, 'userRatingCount' => 80, 'rating' => 4.7, 'reviews' => [['rating' => 5, 'text' => 'Great', 'publishTime' => lf_now_iso()]]], $over);
test('complete profile → no confirmed Google issues', fn() => eq($ids(lf_audit_gbp($g(), ['industryId' => 'interior-design'], $S)['issues']), []));
test('missing profile items become issues; missing website link is not proof of no website', function () use ($g, $S) {
  $r = lf_audit_gbp($g(['websiteUri' => '', 'nationalPhoneNumber' => '', 'regularOpeningHours' => null, 'photoCount' => 0, 'userRatingCount' => 5, 'rating' => 3.2]), ['industryId' => 'interior-design', 'websiteKnown' => false], $S);
  $by = array_column($r['issues'], 'status', 'id');
  foreach (['gbp-no-phone', 'gbp-no-hours', 'gbp-no-photos', 'gbp-low-reviews', 'gbp-low-rating'] as $k) eq($by[$k] ?? null, 'Confirmed Issue', $k);
  eq($by['gbp-no-website'], 'Potential Improvement');
  $l = lf_audit_gbp($g(['websiteUri' => '']), ['websiteKnown' => true, 'websiteUrl' => 'https://x.example'], $S);
  eq(array_column($l['issues'], 'status', 'id')['gbp-website-not-linked'], 'Confirmed Issue');
});
test('industry benchmarks are applied', function () use ($g, $S) {
  ok_(in_array('gbp-low-reviews', array_column(lf_audit_gbp($g(['userRatingCount' => 40]), ['industryId' => 'restaurants-cafes'], $S)['issues'], 'id'), true));
  ok_(!in_array('gbp-low-reviews', array_column(lf_audit_gbp($g(['userRatingCount' => 40]), ['industryId' => 'interior-design'], $S)['issues'], 'id'), true));
});
test('no Google profile or expired data → Not Available, no invented issues', function () use ($S) { eq(lf_audit_gbp(null, [], $S)['status'], 'Not Available'); eq(count(lf_audit_gbp(['placeId' => 'p', 'expired' => true], [], $S)['issues']), 0); });
test('review analysis is honest about sample size, authenticity and owner replies', function () use ($g, $S) {
  $r = lf_analyze_reviews($g(['reviews' => [['rating' => 1, 'text' => 'Waited an hour, very slow and late', 'publishTime' => lf_now_iso(), 'author' => 'A'], ['rating' => 2, 'text' => 'Long wait again, delay on delivery', 'publishTime' => lf_now_iso(), 'author' => 'B'], ['rating' => 5, 'text' => 'Friendly staff, excellent quality', 'publishTime' => lf_now_iso(), 'author' => 'C']]]), $S);
  eq($r['status'], 'Analysed'); eq($r['sampleSize'], 3); eq($r['confidence'], 'Low'); match_('/not been independently verified/', $r['authenticityNote']); eq($r['ownerReplies']['status'], 'Not Available');
  eq($r['repeatedComplaints'][0]['theme'], 'Waiting time and speed'); ok_(in_array('Staff and service', array_column($r['positiveThemes'], 'theme'), true));
});
test('no reviews → no invented themes', function () use ($g, $S) { $r = lf_analyze_reviews($g(['reviews' => [], 'userRatingCount' => 0]), $S); eq($r['status'], 'No reviews'); eq($r['negativeThemes'], []); });
test('pitches only for qualified leads, built from real findings, with opt-out and no guarantees', function () use ($S) {
  $c = ['name' => 'Olive Interiors', 'industryName' => 'Interior design', 'city' => 'Dubai', 'contact' => ['website' => 'https://olive.example'], 'website' => ['domain' => 'olive.example'], 'validation' => ['category' => 'Qualified'],
    'issues' => [['id' => 'no-meta-desc', 'status' => 'Confirmed Issue', 'title' => 'Missing meta description', 'detail' => 'Search results will show auto-generated text.']], 'services' => [['name' => 'Technical SEO', 'group' => 'search', 'reasons' => ['Missing meta description']]]];
  $p = lf_generate_pitches($c, $S);
  foreach (['email', 'whatsapp', 'call', 'proposal', 'auditOffer'] as $k) ok_(str_contains($p[$k], 'Olive Interiors'), $k);
  ok_(str_contains($p['email'], 'Missing meta description')); ok_(str_contains($p['email'], 'Technical SEO'));
  match_('/unsubscribe/i', $p['email']); match_('/STOP/', $p['whatsapp']); match_('/no rankings, traffic or revenue outcomes are guaranteed/i', $p['proposal']);
  ok_(!preg_match('/\d+%/', $p['email'] . $p['proposal']), 'no invented statistics');
  eq(lf_generate_pitches(['validation' => ['category' => 'Unverified']] + $c, $S), null);
});
