<?php
/* Lead Finder · DEMONSTRATION DATA ONLY. Fictional businesses on reserved ".example" domains, flagged demo and hidden unless Demo mode is on. */
declare(strict_types=1);

function lf_demo_days(int $d): string { return lf_now_iso(microtime(true) - $d * 86400); }
function lf_demo_g(array $o): array {
  $o += ['city' => 'Dubai', 'area' => '', 'status' => 'OPERATIONAL', 'reviews' => [], 'photos' => 3, 'hours' => true, 'phone' => true, 'website' => ''];
  return ['placeId' => 'DEMO_' . $o['id'] . '_xxxxxxxx', 'fetchedAt' => lf_now_iso(), 'source' => 'DEMO DATA (not from Google)', 'displayName' => $o['name'],
    'formattedAddress' => $o['address'], 'addressComponents' => [['longText' => $o['area'] ?: $o['city'], 'types' => ['sublocality']], ['longText' => $o['city'], 'types' => ['locality']], ['longText' => 'United Arab Emirates', 'shortText' => 'AE', 'types' => ['country']]],
    'location' => ['latitude' => 25.2, 'longitude' => 55.27], 'googleMapsUri' => 'https://maps.google.com/?q=' . rawurlencode('DEMO ' . $o['name']), 'websiteUri' => $o['website'],
    'nationalPhoneNumber' => $o['phone'] ? '+971 4 000 00' . str_pad((string) $o['id'], 2, '0', STR_PAD_LEFT) . ' (demo)' : '', 'businessStatus' => $o['status'],
    'regularOpeningHours' => $o['hours'] ? ['weekdayDescriptions' => ['Monday: 9 AM – 6 PM (demo)']] : null, 'rating' => $o['rating'], 'userRatingCount' => $o['count'], 'reviews' => $o['reviews'], 'photoCount' => $o['photos'],
    'primaryType' => $o['types'][0], 'primaryTypeDisplayName' => str_replace('_', ' ', $o['types'][0]), 'types' => array_merge($o['types'], ['point_of_interest', 'establishment']), 'editorialSummary' => ''];
}
function lf_demo_rv(int $days, int $rating, string $text): array { return ['rating' => $rating, 'text' => $text, 'publishTime' => lf_demo_days($days), 'author' => 'Demo reviewer']; }
function lf_demo_site(string $url, array $page, array $extra = []): array {
  $a = ['status' => 'Checked', 'url' => $url, 'finalUrl' => $url, 'domain' => parse_url($url, PHP_URL_HOST), 'checkedAt' => lf_now_iso(), 'demo' => true,
    'availability' => ['ok' => true, 'httpStatus' => 200, 'responseMs' => $extra['responseMs'] ?? 900], 'https' => ['usesHttps' => str_starts_with($url, 'https'), 'httpRedirectsToHttps' => $extra['redirect'] ?? true],
    'sitemap' => $extra['sitemap'] ?? false, 'brokenLinks' => $extra['broken'] ?? ['checked' => 10, 'broken' => []],
    'pagespeed' => array_merge(['status' => 'Tested', 'source' => 'DEMO values — not a real test', 'testedAt' => lf_now_iso()], $extra['ps'] ?? []),
    'page' => array_merge(['title' => '', 'metaDescription' => null, 'viewport' => true, 'robots' => '', 'canonical' => null, 'h1s' => ['Welcome'], 'wordCount' => 400, 'ldTypes' => [], 'imageCount' => 6, 'imagesWithoutAlt' => 1,
      'forms' => 0, 'emails' => [], 'social' => [], 'whatsapp' => false, 'tel' => true, 'mailto' => true, 'ctas' => [], 'contactPage' => $url . 'contact', 'copyrightYear' => (int) gmdate('Y'),
      'generator' => '', 'ecomSignals' => [], 'mapEmbed' => false, 'addressOnSite' => false, 'jsRendered' => false, 'questionHeadings' => 0], $page)];
  $a['issues'] = lf_derive_issues($a, []);
  return $a;
}
function lf_demo_list(): array {
  $d = fn($n) => substr(lf_demo_days($n), 0, 10);
  return [
    ['name' => 'Olive & Oak Interiors', 'industryId' => 'interior-design', 'area' => 'Al Quoz', 'est' => $d(700), 'google' => ['id' => 1, 'address' => 'Warehouse 12, Al Quoz 3, Dubai (demo)', 'area' => 'Al Quoz', 'types' => ['interior_designer'], 'rating' => 4.6, 'count' => 14, 'reviews' => [lf_demo_rv(20, 5, 'Friendly team and great quality finish.'), lf_demo_rv(90, 4, 'Good design, a bit of a wait for the quote.')], 'photos' => 2, 'website' => 'https://olive-oak.example/'],
      'audit' => ['https://olive-oak.example/', ['title' => 'Home', 'metaDescription' => null], ['ps' => ['performance' => 38, 'seo' => 72, 'accessibility' => 85, 'bestPractices' => 78]]]],
    ['name' => 'Glow Lab Beauty Lounge', 'industryId' => 'beauty-spa', 'area' => 'Jumeirah', 'est' => $d(400), 'noWebsite' => true, 'google' => ['id' => 2, 'address' => 'Shop 4, Jumeirah Beach Road, Dubai (demo)', 'area' => 'Jumeirah', 'types' => ['beauty_salon'], 'rating' => 4.8, 'count' => 9, 'reviews' => [lf_demo_rv(10, 5, 'Lovely staff, very clean.'), lf_demo_rv(45, 5, 'Best nails in the area.')], 'photos' => 4]],
    ['name' => 'Bayside Physio Clinic', 'industryId' => 'healthcare', 'area' => 'Dubai Marina', 'est' => $d(1300), 'google' => ['id' => 3, 'address' => 'Office 210, Marina Plaza, Dubai Marina (demo)', 'area' => 'Dubai Marina', 'types' => ['physiotherapist'], 'rating' => 3.8, 'count' => 26, 'reviews' => [lf_demo_rv(15, 2, 'Had to wait 40 minutes past my appointment.'), lf_demo_rv(60, 2, 'Long wait again and no call back.'), lf_demo_rv(100, 5, 'Helpful therapist.')], 'photos' => 6, 'website' => 'https://bayside-physio.example/'],
      'audit' => ['https://bayside-physio.example/', ['title' => 'Bayside Physio Clinic | Physiotherapy in Dubai Marina', 'metaDescription' => 'Physiotherapy clinic in Dubai Marina.', 'forms' => 1, 'ctas' => ['Book now'], 'addressOnSite' => true, 'ldTypes' => ['MedicalClinic']], ['ps' => ['performance' => 61, 'seo' => 92, 'accessibility' => 88, 'bestPractices' => 96], 'sitemap' => true]]],
    ['name' => 'Nomad Coffee Roasters', 'industryId' => 'restaurants-cafes', 'area' => 'Business Bay', 'sources' => ['rdap' => $d(900), 'wayback' => $d(850)], 'google' => ['id' => 4, 'address' => 'Bay Square 7, Business Bay, Dubai (demo)', 'area' => 'Business Bay', 'types' => ['coffee_shop', 'cafe'], 'rating' => 4.4, 'count' => 31, 'reviews' => [lf_demo_rv(5, 5, 'Excellent coffee.')], 'photos' => 8, 'website' => 'https://nomad-coffee.example/'],
      'audit' => ['https://nomad-coffee.example/', ['title' => 'Nomad Coffee Roasters', 'metaDescription' => 'Specialty coffee.', 'whatsapp' => false], ['ps' => ['performance' => 55, 'seo' => 85, 'accessibility' => 90, 'bestPractices' => 92]]]],
    ['name' => 'Falcon Auto Detailing', 'industryId' => 'automobile', 'area' => 'Al Qusais', 'google' => ['id' => 5, 'address' => 'Al Qusais Industrial Area 2, Dubai (demo)', 'area' => 'Al Qusais', 'types' => ['car_wash'], 'rating' => 4.1, 'count' => 6, 'reviews' => [lf_demo_rv(800, 4, 'Good job on my car.')], 'photos' => 1, 'hours' => false]],
    ['name' => 'Al Noor Interiors', 'industryId' => 'interior-design', 'area' => 'Deira', 'google' => ['id' => 6, 'address' => 'Al Rigga Road, Deira, Dubai (demo)', 'area' => 'Deira', 'types' => ['interior_designer'], 'rating' => 4.0, 'count' => 85, 'reviews' => [lf_demo_rv(2900, 4, 'Used them years ago, good service.'), lf_demo_rv(30, 3, 'Okay.')], 'photos' => 9, 'website' => 'https://alnoor-interiors.example/']],
    ['name' => 'Urban Fit Studio', 'industryId' => 'beauty-spa', 'area' => 'JLT', 'google' => ['id' => 7, 'address' => 'Cluster D, JLT, Dubai (demo)', 'area' => 'JLT', 'types' => ['spa'], 'status' => 'CLOSED_PERMANENTLY', 'rating' => 4.2, 'count' => 40, 'photos' => 5]],
    ['name' => 'MegaMart Interiors Superstore', 'industryId' => 'interior-design', 'area' => 'Al Barsha', 'google' => ['id' => 8, 'address' => 'Mall of the Emirates area, Al Barsha, Dubai (demo)', 'area' => 'Al Barsha', 'types' => ['interior_designer', 'home_goods_store'], 'rating' => 4.3, 'count' => 3200, 'photos' => 10, 'website' => 'https://megamart.example/']],
    ['name' => 'Corniche Dental Care', 'industryId' => 'healthcare', 'area' => 'Al Khalidiyah', 'google' => ['id' => 9, 'address' => 'Corniche Road, Al Khalidiyah, Abu Dhabi (demo)', 'city' => 'Abu Dhabi', 'area' => 'Al Khalidiyah', 'types' => ['dental_clinic'], 'rating' => 4.7, 'count' => 60, 'photos' => 7]],
    ['name' => 'Pixel Perfect IT Solutions', 'industryId' => 'it-services', 'area' => 'Dubai Internet City', 'est' => $d(500), 'google' => ['id' => 10, 'address' => 'Building 5, Dubai Internet City (demo)', 'area' => 'Dubai Internet City', 'types' => ['computer_store'], 'rating' => 4.9, 'count' => 64, 'reviews' => [lf_demo_rv(12, 5, 'Very professional and quick.')], 'photos' => 10, 'website' => 'https://pixel-perfect.example/'],
      'audit' => ['https://pixel-perfect.example/', ['title' => 'Pixel Perfect IT Solutions | Managed IT in Dubai', 'metaDescription' => 'Managed IT services and support for Dubai SMEs.', 'canonical' => 'https://pixel-perfect.example/', 'forms' => 1, 'whatsapp' => true, 'ctas' => ['Get a quote'], 'addressOnSite' => true, 'ldTypes' => ['LocalBusiness', 'FAQPage'], 'social' => ['linkedin' => 'https://linkedin.com/company/demo']], ['ps' => ['performance' => 92, 'seo' => 100, 'accessibility' => 95, 'bestPractices' => 100], 'sitemap' => true]]],
  ];
}
function lf_load_demo(): int {
  $s = array_merge(lf_settings(), ['demoMode' => true]); $n = 0;
  foreach (lf_demo_list() as $d) {
    $indName = ''; foreach ($s['industries'] as $i) if ($i['id'] === $d['industryId']) $indName = $i['name'];
    $c = lf_new_record(['name' => '[DEMO] ' . $d['name'], 'demo' => true, 'industryId' => $d['industryId'], 'industryName' => $indName, 'country' => 'United Arab Emirates', 'city' => 'Dubai', 'area' => $d['area'],
      'source' => ['type' => 'demo', 'detail' => 'Demonstration data — fictional company', 'at' => lf_now_iso()]]);
    lf_merge_google($c, lf_demo_g(array_merge($d['google'], ['name' => '[DEMO] ' . $d['name']])));
    $c['name'] = '[DEMO] ' . $d['name'];
    if (!empty($d['est'])) $c['manual']['establishment'] = ['date' => $d['est'], 'source' => 'DEMO trade licence record (fictional)', 'enteredAt' => lf_now_iso(), 'by' => 'Demo'];
    if (!empty($d['noWebsite'])) { $c['manual']['noWebsiteConfirmed'] = true; $c['manual']['noWebsiteNote'] = 'DEMO: team confirmed no website exists.'; $c['manual']['noWebsiteAt'] = lf_now_iso(); }
    if (!empty($d['audit'])) $c['websiteAudit'] = lf_demo_site(...$d['audit']);
    if (!empty($d['sources'])) $c['ageSources'] = ['rdap' => ['status' => 'Found', 'date' => $d['sources']['rdap'], 'source' => 'DEMO domain record', 'checkedAt' => lf_now_iso()], 'wayback' => ['status' => 'Found', 'date' => $d['sources']['wayback'], 'source' => 'DEMO archive record', 'checkedAt' => lf_now_iso()]];
    if (lf_find_duplicate($c)) continue;
    lf_process_company($c, ['settings' => $s, 'offline' => true]);
    lf_company_put($c); $n++;      // demo records never create Canvass businesses
  }
  return $n;
}
function lf_clear_demo(): int { $st = db()->prepare('DELETE FROM lf_companies WHERE demo=1'); $st->execute(); return $st->rowCount(); }
