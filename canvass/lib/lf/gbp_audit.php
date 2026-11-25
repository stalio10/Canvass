<?php
/* Lead Finder · Google Business Profile audit + customer review analysis. Uses only data returned by the authorised Places API. */
declare(strict_types=1);

const LF_THEMES = [
  ['Staff and service', '/\b(staff|service|rude|friendly|helpful|polite|attitude|customer service|manager|team)\b/i'],
  ['Quality of work or product', '/\b(quality|excellent|poor|bad job|workmanship|finish|taste|delicious|tasty|fresh|result|professional)\b/i'],
  ['Price and value', '/\b(price|expensive|cheap|overpriced|value|cost|charges?|affordable|money)\b/i'],
  ['Waiting time and speed', '/\b(wait(ed|ing)?|late|delay(ed)?|slow|quick|fast|on time|took (too )?long|hours? to)\b/i'],
  ['Cleanliness', '/\b(clean|dirty|hygien\w*|smell|messy|tidy)\b/i'],
  ['Communication and follow-up', '/\b(call(ed)? back|respon(se|d|sive)|no reply|ignored|whatsapp|follow[- ]?up|communication|answer(ed)? the phone)\b/i'],
  ['Booking and appointments', '/\b(appointment|booking|booked|reservation|schedul\w*)\b/i'],
  ['Delivery', '/\b(deliver(y|ed)|courier|shipping|order (arrived|never))\b/i'],
  ['Location and parking', '/\b(parking|location|hard to find|directions|access)\b/i'],
];
const LF_NEGATIVE_WORDS = '/\b(not|never|worst|terrible|awful|poor|rude|bad|disappoint\w*|unprofessional|waste|horrible|avoid|scam|overpriced|dirty|late|delay\w*|ignored)\b/i';

function lf_theme_list(array $o): array { arsort($o); $out = []; foreach ($o as $t => $c) $out[] = ['theme' => $t, 'count' => $c]; return $out; }

function lf_analyze_reviews(?array $google, array $settings, ?float $today = null): array {
  $at = lf_now_iso();
  if (!$google || !empty($google['expired'])) return ['status' => 'Not Available', 'note' => !empty($google['expired']) ? 'Google data expired after the retention period — refresh to re-analyse.' : 'No Google Business data for this company.', 'analysedAt' => $at];
  $reviews = array_values(array_filter($google['reviews'] ?? [], fn($r) => ($r['text'] ?? '') !== '' || ($r['rating'] ?? null) !== null));
  $n = count($reviews);
  $base = ['rating' => $google['rating'] ?? null, 'totalReviews' => $google['userRatingCount'] ?? null, 'sampleSize' => $n, 'analysedAt' => $at, 'source' => ($google['googleMapsUri'] ?? '') ?: 'Google Places API',
    'authenticityNote' => 'Reviews are customer opinions supplied by Google. Their authenticity has not been independently verified.',
    'sampleNote' => "Analysis uses the $n review(s) Google returns through the API (maximum 5), not the full review history.",
    'ownerReplies' => ['status' => 'Not Available', 'note' => 'The Places API does not report whether the owner replied to reviews.']];
  if (!$n) return $base + ['status' => !empty($google['userRatingCount']) ? 'No sample' : 'No reviews', 'positiveThemes' => [], 'negativeThemes' => [], 'repeatedComplaints' => [], 'recentDates' => [], 'confidence' => 'Not Applicable'];
  $pos = []; $neg = []; $items = [];
  foreach ($reviews as $r) {
    $rating = $r['rating'] ?? null; $text = (string) ($r['text'] ?? '');
    $sentiment = ($rating !== null && $rating >= 4) ? 'positive' : (($rating !== null && $rating <= 2) ? 'negative' : (preg_match(LF_NEGATIVE_WORDS, $text) ? 'negative' : 'mixed'));
    $themes = []; foreach (LF_THEMES as [$t, $re]) if (preg_match($re, $text)) $themes[] = $t;
    foreach ($themes as $t) { if ($sentiment === 'positive') $pos[$t] = ($pos[$t] ?? 0) + 1; if ($sentiment === 'negative') $neg[$t] = ($neg[$t] ?? 0) + 1; }
    $items[] = ['date' => lf_valid_date($r['publishTime'] ?? null) ? substr($r['publishTime'], 0, 10) : '', 'rating' => $rating, 'sentiment' => $sentiment, 'themes' => $themes, 'author' => $r['author'] ?? '', 'excerpt' => mb_substr($text, 0, 220)];
  }
  $repeated = array_values(array_filter(lf_theme_list($neg), fn($x) => $x['count'] >= 2));
  $recent = array_values(array_filter(array_column($items, 'date'), 'strlen')); rsort($recent);
  $opp = [];
  if ($repeated) $opp[] = 'Respond to recurring feedback about ' . implode(', ', array_map(fn($r) => mb_strtolower($r['theme']), $repeated));
  if (array_filter($items, fn($i) => $i['sentiment'] === 'negative')) $opp[] = 'Review management: public, professional responses to negative reviews';
  if (!$recent || lf_months_between($recent[0], $today) > $settings['recentReviewMonths']) $opp[] = 'Encourage recent customers to leave reviews';
  return $base + ['status' => 'Analysed', 'items' => $items, 'positiveThemes' => lf_theme_list($pos), 'negativeThemes' => lf_theme_list($neg), 'repeatedComplaints' => $repeated, 'recentDates' => $recent, 'opportunities' => $opp,
    'confidence' => $n >= 4 ? 'Medium' : 'Low', 'confidenceNote' => 'Confidence is limited by the small review sample available through the API.'];
}

function lf_benchmark_for(array $settings, string $industryId): array { return array_merge($settings['benchmarks']['default'], $settings['benchmarks'][$industryId] ?? []); }

function lf_audit_gbp(?array $google, array $ctx, array $settings, ?float $today = null): array {
  if (!$google || empty($google['placeId'])) return ['status' => 'Not Available', 'note' => 'No Google Business Profile matched this company.', 'issues' => []];
  if (!empty($google['expired'])) return ['status' => 'Not Available', 'note' => 'Google data expired after the retention period — refresh to audit again.', 'issues' => []];
  $b = lf_benchmark_for($settings, (string) ($ctx['industryId'] ?? ''));
  $issues = [];
  $add = function ($id, $group, $status, $title, $detail, $services) use (&$issues, $google) { $issues[] = ['id' => $id, 'area' => 'gbp', 'group' => $group, 'status' => $status, 'title' => $title, 'detail' => $detail, 'services' => $services, 'evidence' => ($google['googleMapsUri'] ?? '') ?: 'Google Places API', 'checkedAt' => $google['fetchedAt'] ?? null]; };
  if (empty($google['formattedAddress'])) $add('gbp-no-address', 'Location', LF_CONFIRMED, 'Missing business address', 'No address on the Google Business Profile.', ['Google Business Profile optimization', 'Local SEO']);
  else {
    $types = []; foreach ($google['addressComponents'] ?? [] as $c) foreach ($c['types'] ?? [] as $t) $types[$t] = true;
    if (!array_intersect_key($types, array_flip(['street_number', 'route', 'premise', 'subpremise', 'street_address'])) && !preg_match('/\d/', $google['formattedAddress']))
      $add('gbp-incomplete-address', 'Location', LF_POTENTIAL, 'Address may be incomplete', "Listed as \"{$google['formattedAddress']}\" with no street or building.", ['Google Business Profile optimization', 'Local SEO']);
  }
  if (empty($google['location'])) $add('gbp-no-pin', 'Location', LF_CONFIRMED, 'No map location', 'Profile has no map coordinates, so directions cannot be given.', ['Google Business Profile optimization']);
  if (empty($google['websiteUri'])) {
    if (!empty($ctx['websiteKnown'])) $add('gbp-website-not-linked', 'Profile', LF_CONFIRMED, 'Website not linked on Google profile', "The business has a website ({$ctx['websiteUrl']}) but the profile does not link to it.", ['Google Business Profile optimization', 'Local SEO']);
    else $add('gbp-no-website', 'Profile', LF_POTENTIAL, 'No website listed on Google profile', 'Not proof the business has no website — no website was found in the checked sources either.', ['Website design', 'Website development', 'Google Business Profile optimization']);
  }
  if (empty($google['nationalPhoneNumber']) && empty($google['internationalPhoneNumber'])) $add('gbp-no-phone', 'Profile', LF_CONFIRMED, 'No phone number on profile', 'Customers cannot call from Google Maps.', ['Google Business Profile optimization']);
  if (empty($google['regularOpeningHours']['weekdayDescriptions'])) $add('gbp-no-hours', 'Profile', LF_CONFIRMED, 'Working hours missing', 'No opening hours on the profile.', ['Google Business Profile optimization']);
  if (empty($google['editorialSummary'])) $add('gbp-no-description', 'Profile', LF_POTENTIAL, 'No business summary available', 'Google returned no editorial summary. The owner-written description is not available through the API, so this is a prompt to check.', ['Google Business Profile optimization', 'Copywriting']);
  $specific = array_values(array_filter($google['types'] ?? [], fn($t) => !in_array($t, ['point_of_interest', 'establishment'], true)));
  if (empty($google['primaryType']) || count($specific) < 2) $add('gbp-category', 'Profile', LF_POTENTIAL, 'Business categories may be incomplete', 'Categories found: ' . (implode(', ', $specific) ?: 'none') . '.', ['Google Business Profile optimization', 'Local SEO']);
  $photos = (int) ($google['photoCount'] ?? 0);
  if (!$photos) $add('gbp-no-photos', 'Photos', LF_CONFIRMED, 'No photos on profile', 'Google returned no photos for this business.', ['Business photography', 'Google Business Profile optimization']);
  elseif ($photos < $b['minPhotos']) $add('gbp-few-photos', 'Photos', LF_POTENTIAL, 'Few photos visible', "$photos photo(s) returned (API shows at most 10; benchmark {$b['minPhotos']}).", ['Business photography', 'Product photography']);
  $count = $google['userRatingCount'] ?? null;
  if (!$count) $add('gbp-no-reviews', 'Reviews', LF_CONFIRMED, 'No customer reviews', 'The profile has no Google reviews.', ['Reputation and review management', 'Google Business Profile optimization']);
  elseif ($count < $b['minReviews']) $add('gbp-low-reviews', 'Reviews', LF_CONFIRMED, 'Low review count', "$count reviews (industry benchmark {$b['minReviews']}).", ['Reputation and review management']);
  if (($google['rating'] ?? null) !== null && $count && $google['rating'] < $b['minRating']) $add('gbp-low-rating', 'Reviews', LF_CONFIRMED, 'Rating below benchmark', "Rated {$google['rating']} (benchmark {$b['minRating']}).", ['Reputation and review management']);
  $dates = []; foreach ($google['reviews'] ?? [] as $r) if (lf_valid_date($r['publishTime'] ?? null)) $dates[] = $r['publishTime'];
  usort($dates, fn($x, $y) => lf_ts($x) <=> lf_ts($y));
  if ($count && $dates && lf_months_between(end($dates), $today) > $settings['recentReviewMonths'])
    $add('gbp-no-recent-reviews', 'Reviews', LF_POTENTIAL, 'No recent reviews in available sample', 'Latest review in the API sample is from ' . substr(end($dates), 0, 10) . '.', ['Reputation and review management']);
  foreach ($ctx['reviewAnalysis']['repeatedComplaints'] ?? [] as $r)
    $add('gbp-complaint-' . preg_replace('/\W+/', '-', mb_strtolower($r['theme'])), 'Reviews', LF_POTENTIAL, 'Repeated customer feedback: ' . mb_strtolower($r['theme']), "Mentioned in {$r['count']} negative reviews in the available sample (customer opinions, not verified facts).", ['Reputation and review management']);
  $gaps = count(array_filter($issues, fn($i) => in_array($i['group'], ['Location', 'Profile'], true)));
  if ($gaps >= 3) $add('gbp-incomplete', 'Local SEO', LF_POTENTIAL, 'Incomplete Google presence', "$gaps profile gaps reduce local search visibility.", ['Local SEO', 'Google Business Profile optimization']);
  return ['status' => 'Checked', 'checkedAt' => $google['fetchedAt'] ?? null, 'benchmark' => $b, 'issues' => $issues,
    'notChecked' => ['Unanswered reviews (not available through the Places API)', 'Exact map pin accuracy (requires on-site confirmation)', 'Full photo and review history (API returns samples only)']];
}
