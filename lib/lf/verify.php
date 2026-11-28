<?php
/* Lead Finder · verification: age, activity, industry relevance, location, size. Every finding carries its source and timestamp. */
declare(strict_types=1);

function lf_rdap_registration(string $domain): array {
  $root = lf_registrable_domain($domain); $checkedAt = lf_now_iso();
  try {
    $res = LfHttp::fetch('https://rdap.org/domain/' . rawurlencode($root), ['api' => 'rdap', 'timeout' => 20, 'retries' => 1, 'headers' => ['accept' => 'application/rdap+json, application/json']]);
    if ($res['status'] === 404) return ['status' => 'Not Available', 'source' => 'RDAP (rdap.org)', 'checkedAt' => $checkedAt, 'note' => "No RDAP record published for $root"];
    if (!$res['ok']) return ['status' => 'Not Available', 'source' => 'RDAP (rdap.org)', 'checkedAt' => $checkedAt, 'note' => 'RDAP lookup returned HTTP ' . $res['status']];
    $data = json_decode($res['body'], true) ?: [];
    $ev = null; foreach ($data['events'] ?? [] as $e) if (preg_match('/registration/i', (string) ($e['eventAction'] ?? ''))) { $ev = $e; break; }
    if (!$ev || !lf_valid_date($ev['eventDate'] ?? null)) return ['status' => 'Not Available', 'source' => 'RDAP', 'checkedAt' => $checkedAt, 'note' => 'Registry did not publish a registration date'];
    $self = "https://rdap.org/domain/$root"; foreach ($data['links'] ?? [] as $l) if (($l['rel'] ?? '') === 'self' && !empty($l['href'])) { $self = $l['href']; break; }
    return ['status' => 'Found', 'date' => substr($ev['eventDate'], 0, 10), 'source' => 'RDAP domain registration record', 'url' => $self, 'checkedAt' => $checkedAt, 'domain' => $root];
  } catch (Throwable $e) { if ($e instanceof ApiError && $e->errCode === 'BUDGET') throw $e; return ['status' => 'Not Available', 'source' => 'RDAP', 'checkedAt' => $checkedAt, 'note' => 'Lookup failed: ' . $e->getMessage()]; }
}

function lf_wayback_first_capture(string $domain): array {
  $checkedAt = lf_now_iso();
  try {
    $u = 'https://web.archive.org/cdx/search/cdx?url=' . rawurlencode($domain) . '&limit=1&output=json&fl=timestamp,original&filter=statuscode:200';
    $res = LfHttp::fetch($u, ['api' => 'wayback', 'timeout' => 30, 'retries' => 1]);
    if (!$res['ok']) return ['status' => 'Not Available', 'source' => 'Internet Archive', 'checkedAt' => $checkedAt, 'note' => 'Archive returned HTTP ' . $res['status']];
    $rows = json_decode($res['body'], true) ?: [];
    $first = $rows[1] ?? null;
    if (!$first) return ['status' => 'Not Found', 'source' => 'Internet Archive Wayback Machine', 'checkedAt' => $checkedAt, 'note' => 'No archived captures of this domain'];
    $ts = (string) $first[0];
    return ['status' => 'Found', 'date' => substr($ts, 0, 4) . '-' . substr($ts, 4, 2) . '-' . substr($ts, 6, 2), 'source' => 'Internet Archive first capture', 'url' => "https://web.archive.org/web/$ts/{$first[1]}", 'checkedAt' => $checkedAt];
  } catch (Throwable $e) { return ['status' => 'Not Available', 'source' => 'Internet Archive', 'checkedAt' => $checkedAt, 'note' => 'Lookup failed: ' . $e->getMessage()]; }
}

function lf_window_start(int $years, ?float $today): string {
  $d = (new DateTimeImmutable('@' . (int) ($today ?? time())))->setTimezone(new DateTimeZone('UTC'));
  $y = (int) $d->format('Y') - $years; $m = (int) $d->format('n'); $day = (int) $d->format('j');
  // JS setFullYear: Feb 29 rolls over to Mar 1 in a non-leap year
  if ($m === 2 && $day === 29 && !checkdate(2, 29, $y)) { $m = 3; $day = 1; }
  return sprintf('%04d-%02d-%02d', $y, $m, $day);
}

/**
 * Decide company age from evidence. Statuses: Verified | Estimated | Unverified | Not Available.
 * Documented registration/licence dates and old customer reviews can verify age; domain and archive dates are supporting evidence only.
 */
function lf_assess_age(array $in, array $settings, ?float $today = null): array {
  $today = $today ?? microtime(true);
  $manual = $in['manual'] ?? null; $rdap = $in['rdap'] ?? null; $wayback = $in['wayback'] ?? null; $reviews = $in['reviews'] ?? []; $hasWebsite = !empty($in['hasWebsite']);
  $years = (int) $settings['eligibilityYears']; $ws = lf_window_start($years, $today);
  $evidence = [];
  if (!empty($manual['date'])) $evidence[] = ['kind' => 'establishment', 'label' => 'Documented establishment / licence date', 'date' => $manual['date'], 'source' => $manual['source'] ?? '', 'url' => $manual['url'] ?? '', 'checkedAt' => $manual['enteredAt'] ?? null, 'strength' => 'documented'];
  if (($rdap['status'] ?? '') === 'Found') $evidence[] = ['kind' => 'domain', 'label' => 'Domain registered', 'date' => $rdap['date'], 'source' => $rdap['source'] ?? '', 'url' => $rdap['url'] ?? '', 'checkedAt' => $rdap['checkedAt'] ?? null, 'strength' => 'supporting'];
  if (($wayback['status'] ?? '') === 'Found') $evidence[] = ['kind' => 'archive', 'label' => 'Website first archived', 'date' => $wayback['date'], 'source' => $wayback['source'] ?? '', 'url' => $wayback['url'] ?? '', 'checkedAt' => $wayback['checkedAt'] ?? null, 'strength' => 'supporting'];
  $dated = []; foreach ($reviews as $r) if (lf_valid_date($r['publishTime'] ?? null)) $dated[] = substr($r['publishTime'], 0, 10);
  sort($dated);
  if ($dated) $evidence[] = ['kind' => 'review', 'label' => 'Earliest review in available sample', 'date' => $dated[0], 'source' => 'Google Places reviews (sample of up to 5)', 'url' => '', 'checkedAt' => lf_now_iso(), 'strength' => 'upper-bound'];
  $notes = [];
  $result = function ($status, $within, $basis, $extra = []) use (&$notes, $evidence, $ws, $years, $today) {
    $dates = array_column($evidence, 'date'); sort($dates);
    $earliest = $extra['earliestDate'] ?? ($dates[0] ?? null);
    return array_merge(['status' => $status, 'withinWindow' => $within, 'basis' => $basis, 'windowStart' => $ws, 'eligibilityYears' => $years, 'evidence' => $evidence, 'notes' => $notes], $extra,
      ['earliestDate' => $earliest, 'yearsOld' => isset($extra['earliestDate']) ? round(lf_years_between($extra['earliestDate'], $today) * 10) / 10 : null]);
  };
  $websiteAge = !$hasWebsite ? ['status' => 'Not Applicable']
    : (($wayback['status'] ?? '') === 'Found' ? ['status' => 'Estimated', 'firstSeen' => $wayback['date'], 'source' => $wayback['source'] ?? '', 'url' => $wayback['url'] ?? '', 'withinWindow' => $wayback['date'] >= $ws, 'note' => 'Earliest public archive capture — the site may have launched earlier than archiving began.']
    : ['status' => 'Not Available', 'note' => $wayback['note'] ?? 'No archive record']);

  $doc = null; foreach ($evidence as $e) if ($e['strength'] === 'documented') { $doc = $e; break; }
  if ($doc) {
    $within = $doc['date'] >= $ws;
    if (!$within) $notes[] = "Established {$doc['date']}, before the $years-year window ($ws).";
    $olderReview = $within && $dated && $dated[0] < $doc['date'];
    if ($olderReview) $notes[] = "A customer review dated {$dated[0]} predates the documented date — check the record.";
    return $result($olderReview ? 'Unverified' : 'Verified', $olderReview ? null : $within, 'Documented establishment evidence', ['earliestDate' => $doc['date'], 'websiteAge' => $websiteAge]);
  }
  if ($dated && $dated[0] < $ws) {
    $notes[] = "A customer review dated {$dated[0]} shows the business was operating more than $years years ago.";
    return $result('Verified', false, 'Dated customer review predates the window', ['earliestDate' => $dated[0], 'websiteAge' => $websiteAge]);
  }
  if (!empty($settings['rejectOldWebsiteArchive']) && ($wayback['status'] ?? '') === 'Found' && $wayback['date'] < $ws) {
    $notes[] = "The website has been online since at least {$wayback['date']}. Add a documented establishment date if the business is newer than its domain.";
    return $result('Estimated', false, 'Website archive history predates the window', ['earliestDate' => $wayback['date'], 'websiteAge' => $websiteAge]);
  }
  $supporting = array_values(array_filter($evidence, fn($e) => $e['strength'] === 'supporting'));
  if (!$supporting) {
    $notes[] = 'No reliable age evidence found. Add the trade licence or registration date to verify.';
    return $result($evidence ? 'Unverified' : 'Not Available', null, 'Insufficient evidence', ['websiteAge' => $websiteAge]);
  }
  $older = array_values(array_filter($supporting, fn($e) => $e['date'] < $ws));
  if ($older) {
    $notes[] = implode('; ', array_map(fn($e) => $e['label'] . ' ' . $e['date'], $older)) . ' — older than the window, but a domain can predate the business. Age left unverified.';
    return $result('Unverified', null, 'Conflicting supporting evidence', ['websiteAge' => $websiteAge]);
  }
  $sd = array_column($supporting, 'date'); sort($sd); $earliest = $sd[0];
  $notes[] = 'Supporting evidence only (' . implode(', ', array_column($supporting, 'label')) . "). Domain or archive dates are not proof of the company's establishment date.";
  $accepted = !empty($settings['acceptEstimatedAge']) && count($supporting) >= (int) $settings['ageMinSources'];
  if ($accepted) $notes[] = 'Accepted as an estimate because "Accept consistent estimates" is switched on in Settings.';
  return $result('Estimated', $accepted ? true : null, $accepted ? 'Consistent supporting evidence (accepted estimate)' : 'Supporting evidence only', ['earliestDate' => $earliest, 'websiteAge' => $websiteAge, 'acceptedEstimate' => $accepted]);
}

/** Active-business assessment. */
function lf_assess_activity(array $in, array $settings, ?float $today = null): array {
  $today = $today ?? microtime(true);
  $google = $in['google'] ?? null; $wa = $in['websiteAudit'] ?? null; $manualActivity = $in['manualActivity'] ?? [];
  $evidence = []; $now = lf_now_iso(); $bs = $google['businessStatus'] ?? '';
  if ($bs === 'CLOSED_PERMANENTLY') return ['status' => 'Closed permanently', 'evidence' => [['label' => 'Google Business status: permanently closed', 'source' => 'Google Places API', 'checkedAt' => $google['fetchedAt'] ?? null]], 'recentSignals' => 0];
  if ($bs === 'CLOSED_TEMPORARILY') return ['status' => 'Closed temporarily', 'evidence' => [['label' => 'Google Business status: temporarily closed', 'source' => 'Google Places API', 'checkedAt' => $google['fetchedAt'] ?? null]], 'recentSignals' => 0];
  $recent = 0; $total = 0;
  if ($bs === 'OPERATIONAL') $evidence[] = ['label' => 'Google Business status: operational', 'source' => 'Google Places API', 'checkedAt' => $google['fetchedAt'] ?? null, 'counted' => false, 'note' => 'Listing status alone is not proof of activity'];
  $times = []; foreach ($google['reviews'] ?? [] as $r) if (lf_valid_date($r['publishTime'] ?? null)) $times[] = $r['publishTime'];
  usort($times, fn($a, $b) => lf_ts($a) <=> lf_ts($b)); $latest = $times ? end($times) : null;
  if ($latest) {
    $m = lf_months_between($latest, $today);
    if ($m <= $settings['recentReviewMonths']) { $recent++; $total++; $evidence[] = ['label' => 'Recent customer review (' . substr($latest, 0, 10) . ')', 'source' => 'Google Places reviews', 'checkedAt' => $google['fetchedAt'] ?? null, 'counted' => true]; }
    else $evidence[] = ['label' => 'Latest review in sample is ' . round($m) . ' months old', 'source' => 'Google Places reviews', 'checkedAt' => $google['fetchedAt'] ?? null, 'counted' => false, 'note' => 'Few or old reviews do not mean the business is inactive'];
  }
  if (!empty($wa['availability']['ok'])) { $recent++; $total++; $evidence[] = ['label' => 'Website is online', 'source' => $wa['finalUrl'] ?? '', 'checkedAt' => $wa['checkedAt'] ?? null, 'counted' => true]; }
  if (!empty($google['regularOpeningHours']['weekdayDescriptions'])) { $total++; $evidence[] = ['label' => 'Working hours published', 'source' => 'Google Places API', 'checkedAt' => $google['fetchedAt'] ?? null, 'counted' => true]; }
  if (!empty($google['nationalPhoneNumber']) || !empty($google['internationalPhoneNumber'])) { $total++; $evidence[] = ['label' => 'Public business phone listed', 'source' => 'Google Places API', 'checkedAt' => $google['fetchedAt'] ?? null, 'counted' => true]; }
  if (!empty($google['formattedAddress']) && !empty($google['location'])) { $total++; $evidence[] = ['label' => 'Valid map location and address', 'source' => 'Google Places API', 'checkedAt' => $google['fetchedAt'] ?? null, 'counted' => true]; }
  foreach ($manualActivity as $m) {
    $total++; if (($m['recent'] ?? true) !== false) $recent++;
    $evidence[] = ['label' => $m['label'] ?? 'Team-verified activity', 'source' => $m['source'] ?? '', 'url' => $m['url'] ?? '', 'checkedAt' => $m['enteredAt'] ?? $now, 'counted' => true, 'manual' => true];
  }
  $base = $bs === 'OPERATIONAL' || count($manualActivity) > 0;
  $verified = $base && $recent >= 1 && $total >= $settings['activeMinEvidence'];
  return ['status' => $verified ? 'Verified' : 'Unverified', 'evidence' => $evidence, 'recentSignals' => $recent, 'signals' => $total,
    'note' => $verified ? '' : (!$base ? 'Operational status not confirmed by Google or the team.' : ($recent < 1 ? 'No recent activity evidence (recent review, working website or verified social activity).' : "Only $total activity signal(s); {$settings['activeMinEvidence']} required."))];
}

const LF_GENERIC_TYPES = ['point_of_interest', 'establishment', 'store', 'food', 'health', 'finance', 'premise', 'service', 'local_business', 'business'];
function lf_type_hit(array $ind, string $x): bool { return in_array($x, $ind['types'] ?? [], true) || (!empty($ind['typeSuffix']) && str_ends_with($x, $ind['typeSuffix'])); }
function lf_industry_match(array $ind, array $types = [], string $text = ''): array {
  foreach ($types as $x) if (!in_array($x, LF_GENERIC_TYPES, true) && lf_type_hit($ind, $x)) return ['match' => true, 'by' => 'Google category: ' . $x];
  $low = ' ' . mb_strtolower($text) . ' ';
  foreach ($ind['keywords'] ?? [] as $k) if ($k !== '' && str_contains($low, mb_strtolower($k))) return ['match' => true, 'by' => 'Name/category contains "' . trim($k) . '"'];
  return ['match' => false];
}

/** Industry relevance: Relevant | Irrelevant | Uncertain. */
function lf_assess_industry(array $in, array $industries): array {
  $industryId = $in['industryId'] ?? ''; $google = $in['google'] ?? null;
  if (!$industryId) return ['status' => 'Not Applicable', 'note' => 'No industry selected for this batch'];
  $ind = null; foreach ($industries as $i) if (($i['id'] ?? '') === $industryId) $ind = $i;
  if (!$ind) return ['status' => 'Uncertain', 'note' => 'Unknown industry setting'];
  if (!empty($ind['matchesAny'])) return ['status' => 'Relevant', 'by' => 'Any small or medium business accepted'];
  $types = $google['types'] ?? [];
  $text = implode(' | ', array_filter([$in['name'] ?? '', $google['primaryTypeDisplayName'] ?? '', $google['editorialSummary'] ?? '', $in['uploadIndustry'] ?? '', str_replace('_', ' ', $google['primaryType'] ?? '')], 'strlen'));
  $m = lf_industry_match($ind, $types, $text);
  if ($m['match']) {
    $category = $in['category'] ?? '';
    if ($category) {
      $c = lf_norm_name($category); $nt = lf_norm_name($text); $hit = false;
      foreach (explode(' ', $c) as $w) if (strlen($w) > 3 && str_contains($nt, $w)) $hit = true;
      foreach ($types as $t) if ($c !== '' && str_contains(str_replace('_', ' ', $t), $c)) $hit = true;
      return ['status' => 'Relevant', 'by' => $m['by'] . ($hit ? "; matches category \"$category\"" : ''), 'categoryMatch' => $hit];
    }
    return ['status' => 'Relevant', 'by' => $m['by']];
  }
  $specific = array_values(array_filter($types, fn($x) => !in_array($x, LF_GENERIC_TYPES, true)));
  foreach ($industries as $i) {
    if (($i['id'] ?? '') === $ind['id'] || !empty($i['matchesAny'])) continue;
    foreach ($specific as $x) if (lf_type_hit($i, $x)) return ['status' => 'Irrelevant', 'note' => 'Google lists it as ' . (($google['primaryTypeDisplayName'] ?? '') ?: $i['name']) . ', not ' . $ind['name']];
  }
  return ['status' => 'Uncertain', 'note' => 'Industry could not be confirmed from the available category data'];
}

/** Location check against the requested country/city/area. Matching | Out of location | Unknown. */
function lf_assess_location(array $in): array {
  $google = $in['google'] ?? null; $country = $in['country'] ?? ''; $city = $in['city'] ?? ''; $area = $in['area'] ?? '';
  if (!$country && !$city) return ['status' => 'Not Applicable'];
  $comps = $google['addressComponents'] ?? []; $formatted = ($google['formattedAddress'] ?? '') ?: ($in['address'] ?? '');
  if (!$comps && !$formatted) return ['status' => 'Unknown', 'note' => 'No address available'];
  $has = function (array $typeList, string $value) use ($comps) {
    foreach ($comps as $c) {
      if (!array_intersect($c['types'] ?? [], $typeList)) continue;
      foreach ([$c['longText'] ?? null, $c['shortText'] ?? null] as $v) if ($v !== null && lf_norm_place($v) === lf_norm_place($value)) return true;
    }
    return false;
  };
  $textHas = fn($v) => str_contains(lf_norm_place($formatted), lf_norm_place($v));
  $countryOk = !$country ? true : ($comps ? ($has(['country'], $country) || $textHas($country) || (lf_norm_place($country) === 'united arab emirates' && $has(['country'], 'AE'))) : ($textHas($country) ?: null));
  $cityOk = !$city ? true : ($comps ? ($has(['locality', 'administrative_area_level_1', 'administrative_area_level_2', 'postal_town'], $city) || $textHas($city)) : ($textHas($city) ?: null));
  if ($countryOk === false || $cityOk === false) return ['status' => 'Out of location', 'note' => "Address \"$formatted\" is outside " . implode(', ', array_filter([$city, $country]))];
  if ($countryOk === null || $cityOk === null) return ['status' => 'Unknown', 'note' => 'Address does not state the city or country'];
  $areaOk = !$area || $textHas($area) || $has(['sublocality', 'sublocality_level_1', 'neighborhood', 'locality'], $area);
  return ['status' => 'Matching', 'note' => $areaOk ? '' : 'Within ' . ($city ?: $country) . ", but \"$area\" is not in the address", 'areaMatch' => $areaOk, 'address' => $formatted];
}

/** Large or chain businesses are excluded (we target new and growing SMEs). */
function lf_assess_size(array $in, array $settings, array $chainCounts = []): array {
  $reviews = $in['google']['userRatingCount'] ?? null;
  if (is_numeric($reviews) && $reviews > $settings['largeCompanyReviewThreshold'])
    return ['status' => 'Large', 'note' => "$reviews Google reviews (over {$settings['largeCompanyReviewThreshold']}) suggests a large established business"];
  $n = $chainCounts[lf_norm_name($in['name'] ?? '')] ?? 0;
  if ($n >= $settings['chainLocationThreshold']) return ['status' => 'Large', 'note' => "$n locations with the same name found — likely a chain"];
  return ['status' => 'SME'];
}
