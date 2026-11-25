<?php
/* Lead Finder · default, user-editable settings. API keys live only on the server and are masked when sent to the browser. */
declare(strict_types=1);

function lf_industries(): array {
  return [
    ['id' => 'interior-design', 'name' => 'Interior design', 'types' => ['interior_designer'], 'keywords' => ['interior', 'fit-out', 'fit out', 'fitout', 'decor', 'joinery', 'design studio']],
    ['id' => 'construction', 'name' => 'Construction', 'types' => ['general_contractor', 'electrician', 'plumber', 'roofing_contractor', 'painter', 'hardware_store'], 'keywords' => ['construction', 'contracting', 'contractor', 'building', 'civil', 'renovation', 'maintenance services']],
    ['id' => 'real-estate', 'name' => 'Real estate', 'types' => ['real_estate_agency'], 'keywords' => ['real estate', 'properties', 'property', 'realty', 'homes', 'brokerage']],
    ['id' => 'restaurants-cafes', 'name' => 'Restaurants and cafés', 'types' => ['restaurant', 'cafe', 'coffee_shop', 'bakery', 'meal_takeaway', 'meal_delivery', 'fast_food_restaurant', 'ice_cream_shop', 'juice_shop', 'dessert_shop', 'bar', 'food'], 'typeSuffix' => '_restaurant', 'keywords' => ['restaurant', 'cafe', 'café', 'coffee', 'kitchen', 'bistro', 'eatery', 'grill', 'bakery', 'shawarma']],
    ['id' => 'healthcare', 'name' => 'Healthcare and clinics', 'types' => ['doctor', 'dentist', 'dental_clinic', 'hospital', 'medical_lab', 'physiotherapist', 'pharmacy', 'drugstore', 'chiropractor', 'skin_care_clinic', 'wellness_center', 'health'], 'keywords' => ['clinic', 'medical', 'dental', 'health', 'physio', 'dermatology', 'polyclinic', 'diagnostic']],
    ['id' => 'beauty-spa', 'name' => 'Beauty salons and spas', 'types' => ['beauty_salon', 'hair_salon', 'hair_care', 'spa', 'nail_salon', 'barber_shop', 'beautician', 'massage', 'makeup_artist'], 'keywords' => ['salon', 'spa', 'beauty', 'barber', 'nails', 'lashes', 'massage', 'grooming']],
    ['id' => 'fashion-retail', 'name' => 'Fashion and retail', 'types' => ['clothing_store', 'shoe_store', 'jewelry_store', 'store', 'department_store', 'gift_shop', 'home_goods_store', 'furniture_store', 'florist', 'shopping_mall'], 'keywords' => ['fashion', 'boutique', 'clothing', 'apparel', 'jewellery', 'jewelry', 'abaya', 'store', 'shop']],
    ['id' => 'automobile', 'name' => 'Automobile', 'types' => ['car_repair', 'car_dealer', 'car_wash', 'auto_parts_store', 'car_rental'], 'keywords' => ['auto', 'car ', 'cars', 'garage', 'motors', 'tyre', 'tire', 'detailing', 'automotive']],
    ['id' => 'logistics', 'name' => 'Logistics', 'types' => ['moving_company', 'storage', 'courier_service', 'trucking_company'], 'keywords' => ['logistics', 'freight', 'cargo', 'shipping', 'courier', 'transport', 'movers', 'warehousing']],
    ['id' => 'manufacturing', 'name' => 'Manufacturing', 'types' => ['manufacturer'], 'keywords' => ['manufacturing', 'manufacturer', 'factory', 'industries', 'industrial', 'fabrication']],
    ['id' => 'education', 'name' => 'Education', 'types' => ['school', 'primary_school', 'secondary_school', 'university', 'preschool', 'library'], 'keywords' => ['training', 'institute', 'academy', 'education', 'tutoring', 'learning', 'nursery', 'school', 'courses']],
    ['id' => 'professional-services', 'name' => 'Professional services', 'types' => ['accounting', 'lawyer', 'insurance_agency', 'consultant', 'travel_agency', 'corporate_office'], 'keywords' => ['consult', 'legal', 'law firm', 'accounting', 'audit', 'advisory', 'business setup', 'pro services', 'chartered']],
    ['id' => 'ecommerce', 'name' => 'E-commerce', 'types' => [], 'keywords' => ['online', 'e-commerce', 'ecommerce', 'store', 'shop']],
    ['id' => 'it-services', 'name' => 'IT services', 'types' => ['computer_store', 'electronics_store'], 'keywords' => ['software', 'it services', 'it solutions', 'technology', 'tech', 'web', 'digital', 'computer', 'networking', 'cyber']],
    ['id' => 'sme', 'name' => 'Small and medium enterprises', 'types' => [], 'keywords' => [], 'matchesAny' => true],
  ];
}

function lf_services(): array {
  $list = [['website', 'Website design'], ['website', 'Website redesign'], ['website', 'Website development'], ['website', 'Custom WordPress development'],
    ['website', 'E-commerce development'], ['website', 'Web application development'], ['website', 'Website integrations'], ['website', 'Website maintenance'],
    ['website', 'Website optimization'], ['website', 'Domain and hosting support'], ['website', 'Website backups and monitoring'],
    ['search', 'Technical SEO'], ['search', 'Local SEO'], ['search', 'Keyword research'], ['search', 'Content optimization'],
    ['search', 'Google Business Profile optimization'], ['search', 'Answer Engine Optimization (AEO)'],
    ['creative', 'Branding'], ['creative', 'Graphic design'], ['creative', 'Business photography'], ['creative', 'Product photography'],
    ['creative', 'Video and reels creation'], ['creative', 'Creative content development'], ['creative', 'Copywriting'],
    ['marketing', 'Social media management'], ['marketing', 'Content planning'], ['marketing', 'Social media campaigns'], ['marketing', 'Google Ads'],
    ['marketing', 'Meta Ads'], ['marketing', 'Facebook and Instagram advertising'], ['marketing', 'Lead generation campaigns'],
    ['marketing', 'Digital marketing strategy'], ['marketing', 'Analytics and reporting'], ['search', 'Reputation and review management']];
  return array_map(fn($x) => ['group' => $x[0], 'name' => $x[1], 'enabled' => true], $list);
}

function lf_defaults(): array {
  return [
    'version' => 1, 'googlePlacesKey' => '', 'pageSpeedKey' => '', 'defaultCountry' => 'United Arab Emirates',
    'eligibilityYears' => 5, 'activeMinEvidence' => 2, 'recentReviewMonths' => 12, 'acceptEstimatedAge' => false, 'ageMinSources' => 2,
    'rejectOldWebsiteArchive' => true, 'largeCompanyReviewThreshold' => 1000, 'chainLocationThreshold' => 3, 'requireConfirmedIssue' => true,
    'maxCandidatesPerSearch' => 120,
    'weights' => ['age' => 20, 'activity' => 25, 'gbp' => 25, 'website' => 20, 'contact' => 10],
    'priority' => ['high' => 80, 'medium' => 60],
    'benchmarks' => ['default' => ['minReviews' => 20, 'minRating' => 4.0, 'minPhotos' => 5], 'restaurants-cafes' => ['minReviews' => 50, 'minRating' => 4.2, 'minPhotos' => 10],
      'beauty-spa' => ['minReviews' => 30, 'minRating' => 4.3, 'minPhotos' => 8], 'healthcare' => ['minReviews' => 30, 'minRating' => 4.2, 'minPhotos' => 5]],
    'industries' => lf_industries(), 'services' => lf_services(),
    'company' => ['name' => 'Canvass', 'tagline' => 'Discover. Validate. Analyse. Convert.', 'sender' => 'Team Canvass', 'phone' => '', 'email' => '', 'website' => ''],
    'team' => [],
    'googleRetentionDays' => 30, 'includeGoogleContentInExports' => false, 'runPageSpeed' => true, 'brokenLinkSample' => 12, 'concurrency' => 2,
    'contactCooldownDays' => 14, 'demoMode' => false, 'autoAddToPipeline' => true,
    'budget' => ['enabled' => true, 'placesMonthlyLimit' => 900, 'placesDailyLimit' => 50],   // the owner's chosen free-tier limits
    'costPer1000' => ['places' => 40, 'pagespeed' => 0, 'rdap' => 0, 'wayback' => 0, 'website' => 0],
    'schedules' => [],
  ];
}

const LF_SECRET_FIELDS = ['googlePlacesKey', 'pageSpeedKey'];

function lf_mask($v): string { return $v ? '••••' . substr((string) $v, -4) : ''; }
function lf_env_key(string $field): string {
  $env = ['googlePlacesKey' => 'GOOGLE_PLACES_API_KEY', 'pageSpeedKey' => 'PAGESPEED_API_KEY'][$field] ?? '';
  return $env ? (string) (getenv($env) ?: '') : '';
}
function lf_effective_key(array $s, string $field): string { return lf_env_key($field) ?: (string) ($s[$field] ?? ''); }

function lf_public_settings(array $s): array {
  $out = $s;
  foreach (LF_SECRET_FIELDS as $f) { $out[$f] = lf_mask($s[$f] ?? ''); $out[$f . 'Configured'] = !empty($s[$f]); }
  $out['googlePlacesKeyFromEnv'] = lf_env_key('googlePlacesKey') !== '';
  $out['pageSpeedKeyFromEnv'] = lf_env_key('pageSpeedKey') !== '';
  return $out;
}

function lf_merge_defaults($settings): array {
  $d = lf_defaults(); $settings = is_array($settings) ? $settings : [];
  $s = array_merge($d, $settings);
  foreach (['weights', 'priority', 'company', 'costPer1000', 'budget'] as $k) $s[$k] = array_merge($d[$k], is_array($settings[$k] ?? null) ? $settings[$k] : []);
  $s['benchmarks'] = array_merge($d['benchmarks'], is_array($settings['benchmarks'] ?? null) ? $settings['benchmarks'] : []);
  if (!is_array($s['schedules'])) $s['schedules'] = [];
  return $s;
}

function lf_num($v, $lo, $hi, $d) { if (!is_numeric($v)) return $d; $n = $v + 0; return min($hi, max($lo, $n)); }

/** Merge a settings patch from the browser, validating every field. Masked secrets are ignored. */
function lf_apply_settings_patch(array $cur, array $p): array {
  $s = $cur;
  foreach (LF_SECRET_FIELDS as $f) if (isset($p[$f]) && is_string($p[$f]) && !str_starts_with($p[$f], '••••')) $s[$f] = trim($p[$f]);
  if (isset($p['defaultCountry']) && is_string($p['defaultCountry'])) $s['defaultCountry'] = mb_substr(trim($p['defaultCountry']), 0, 80) ?: $s['defaultCountry'];
  foreach ([['eligibilityYears', 1, 20], ['activeMinEvidence', 1, 5], ['recentReviewMonths', 1, 36], ['ageMinSources', 1, 3], ['largeCompanyReviewThreshold', 50, 100000],
    ['chainLocationThreshold', 2, 50], ['maxCandidatesPerSearch', 5, 500], ['googleRetentionDays', 1, 30], ['brokenLinkSample', 0, 50], ['concurrency', 1, 5], ['contactCooldownDays', 0, 365]] as [$k, $lo, $hi])
    $s[$k] = lf_num($p[$k] ?? null, $lo, $hi, $s[$k]);
  foreach (['acceptEstimatedAge', 'rejectOldWebsiteArchive', 'requireConfirmedIssue', 'includeGoogleContentInExports', 'runPageSpeed', 'demoMode', 'autoAddToPipeline'] as $b)
    if (isset($p[$b]) && is_bool($p[$b])) $s[$b] = $p[$b];
  if (isset($p['weights']) && is_array($p['weights'])) foreach (array_keys($s['weights']) as $k) $s['weights'][$k] = lf_num($p['weights'][$k] ?? null, 0, 100, $s['weights'][$k]);
  if (isset($p['priority']) && is_array($p['priority'])) { $s['priority']['high'] = lf_num($p['priority']['high'] ?? null, 1, 100, $s['priority']['high']); $s['priority']['medium'] = lf_num($p['priority']['medium'] ?? null, 0, $s['priority']['high'], $s['priority']['medium']); }
  if (isset($p['budget']) && is_array($p['budget'])) {
    if (isset($p['budget']['enabled']) && is_bool($p['budget']['enabled'])) $s['budget']['enabled'] = $p['budget']['enabled'];
    $s['budget']['placesMonthlyLimit'] = lf_num($p['budget']['placesMonthlyLimit'] ?? null, 0, 1000000, $s['budget']['placesMonthlyLimit']);
    $s['budget']['placesDailyLimit'] = lf_num($p['budget']['placesDailyLimit'] ?? null, 0, 100000, $s['budget']['placesDailyLimit']);
  }
  if (isset($p['costPer1000']) && is_array($p['costPer1000'])) foreach (array_keys($s['costPer1000']) as $k) $s['costPer1000'][$k] = lf_num($p['costPer1000'][$k] ?? null, 0, 10000, $s['costPer1000'][$k]);
  if (isset($p['benchmarks']) && is_array($p['benchmarks'])) foreach ($p['benchmarks'] as $k => $v) {
    if (!is_array($v)) continue; $base = $s['benchmarks'][$k] ?? $s['benchmarks']['default'];
    $s['benchmarks'][(string) $k] = ['minReviews' => lf_num($v['minReviews'] ?? null, 0, 100000, $base['minReviews']), 'minRating' => lf_num($v['minRating'] ?? null, 1, 5, $base['minRating']), 'minPhotos' => lf_num($v['minPhotos'] ?? null, 0, 10, $base['minPhotos'])];
  }
  if (isset($p['company']) && is_array($p['company'])) foreach (array_keys($s['company']) as $k) if (isset($p['company'][$k]) && is_string($p['company'][$k])) $s['company'][$k] = mb_substr(trim($p['company'][$k]), 0, 200);
  if (isset($p['services']) && is_array($p['services'])) $s['services'] = array_values(array_map(fn($x) => ['group' => (string) ($x['group'] ?? 'website'), 'name' => mb_substr((string) $x['name'], 0, 80), 'enabled' => ($x['enabled'] ?? true) !== false], array_filter($p['services'], fn($x) => is_array($x) && !empty($x['name']))));
  if (isset($p['industries']) && is_array($p['industries'])) {
    $list = fn($v, $lower) => array_values(array_filter(array_map(fn($t) => $lower ? mb_strtolower(trim((string) $t)) : trim((string) $t), is_array($v) ? $v : explode(',', (string) $v)), 'strlen'));
    $s['industries'] = array_values(array_map(function ($x) use ($list) {
      $o = ['id' => substr(trim(preg_replace('/[^a-z0-9]+/', '-', strtolower((string) ($x['id'] ?? $x['name'])))), 0, 40), 'name' => mb_substr((string) $x['name'], 0, 60), 'types' => $list($x['types'] ?? [], false), 'keywords' => $list($x['keywords'] ?? [], true)];
      if (!empty($x['typeSuffix'])) $o['typeSuffix'] = (string) $x['typeSuffix'];
      if (!empty($x['matchesAny'])) $o['matchesAny'] = true;
      return $o;
    }, array_filter($p['industries'], fn($x) => is_array($x) && !empty($x['name']))));
  }
  return $s;
}
