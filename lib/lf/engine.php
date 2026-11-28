<?php
/* Lead Finder · orchestration: discover → verify → audit → validate → score → pitch → Canvass pipeline.
 * Long jobs run in small steps (one search page or one company per step) so they fit PHP shared hosting:
 * a cron job (or the open browser) calls lf_tick() and each call does a few steps, well under the time limit. */
declare(strict_types=1);

const LF_REGION = ['united arab emirates' => 'AE', 'uae' => 'AE', 'saudi arabia' => 'SA', 'ksa' => 'SA', 'qatar' => 'QA', 'oman' => 'OM', 'bahrain' => 'BH', 'kuwait' => 'KW', 'india' => 'IN', 'united kingdom' => 'GB', 'uk' => 'GB', 'united states' => 'US', 'usa' => 'US', 'egypt' => 'EG', 'jordan' => 'JO', 'pakistan' => 'PK'];
function lf_region_code($country): ?string { return LF_REGION[strtolower(trim((string) $country))] ?? null; }

function lf_new_record(array $b): array {
  return ['id' => lf_new_id(), 'createdAt' => lf_now_iso(), 'updatedAt' => lf_now_iso(), 'name' => ($b['name'] ?? '') ?: 'Unnamed business', 'demo' => !empty($b['demo']),
    'industryId' => $b['industryId'] ?? '', 'industryName' => $b['industryName'] ?? '', 'industry' => $b['industry'] ?? '', 'category' => $b['category'] ?? '',
    'country' => $b['country'] ?? '', 'city' => $b['city'] ?? '', 'area' => $b['area'] ?? '',
    'source' => $b['source'] ?? ['type' => 'manual'], 'contact' => [], 'contactSources' => [], 'social' => [], 'manual' => ['activity' => []],
    'google' => null, 'website' => null, 'issues' => [], 'services' => [], 'auditHistory' => [],
    'pipeline' => ['inPipeline' => false, 'stage' => '', 'assignedTo' => '', 'followUpDate' => '', 'notes' => [], 'history' => [], 'contactLog' => [], 'doNotContact' => false]];
}
function lf_set_contact(array &$c, string $field, $value, string $source): void {
  if (!lf_truthy($value)) return;
  $cur = $c['contactSources'][$field] ?? '';
  if (empty($c['contact'][$field]) || $cur === $source || (str_starts_with((string) $cur, 'Google') && !str_starts_with($source, 'Google'))) { $c['contact'][$field] = trim((string) $value); $c['contactSources'][$field] = $source; }
}
function lf_merge_google(array &$c, array $g): void {
  $c['google'] = $g;
  if (!$c['name'] || $c['name'] === 'Unnamed business' || ($c['source']['type'] ?? '') === 'google') $c['name'] = ($g['displayName'] ?? '') ?: $c['name'];
  lf_set_contact($c, 'phone', ($g['internationalPhoneNumber'] ?? '') ?: ($g['nationalPhoneNumber'] ?? ''), 'Google Places');
  lf_set_contact($c, 'address', $g['formattedAddress'] ?? '', 'Google Places');
  $w = $g['websiteUri'] ?? '';
  if ($w && !lf_is_social_url($w)) lf_set_contact($c, 'website', $w, 'Google Places');
  elseif ($w) { $d = lf_domain_of($w); $c['social'][explode('.', $d)[0]] = $w; }
  if (!empty($g['googleMapsUri'])) { $c['contact']['mapsUrl'] = $g['googleMapsUri']; $c['contactSources']['mapsUrl'] = 'Google Places'; }
  if (!empty($g['location'])) {
    $c['contact']['directionsUrl'] = 'https://www.google.com/maps/dir/?api=1&destination=' . rawurlencode($c['name'] . ' ' . ($g['formattedAddress'] ?? '')) . '&destination_place_id=' . rawurlencode($g['placeId']);
    $c['contactSources']['directionsUrl'] = 'Google Places';
  }
}
function lf_push_error(array &$c, string $step, string $msg): void { $c['errors'] = array_slice(array_merge($c['errors'] ?? [], [['at' => lf_now_iso(), 'step' => $step, 'message' => $msg]]), -10); }

/** Run every check for one company. Website opportunity is checked before campaign eligibility is finalized. */
function lf_process_company(array &$c, array $ctx): array {
  $s = $ctx['settings']; $offline = !empty($ctx['offline']);
  $keys = ['places' => lf_effective_key($s, 'googlePlacesKey'), 'pagespeed' => lf_effective_key($s, 'pageSpeedKey')];
  $step = function ($m) use ($ctx, &$c) { if (!empty($ctx['log'])) ($ctx['log'])($c['name'] . ': ' . $m); };
  // 1. Google profile
  if (!$offline && !empty($c['google']['placeId']) && $keys['places'] && (!empty($ctx['refreshGoogle']) || empty($c['google']['fetchedAt']) || !empty($c['google']['expired']))) {
    try { lf_merge_google($c, lf_google_block(lf_place_details($keys['places'], $c['google']['placeId']))); $step('Google profile refreshed'); }
    catch (Throwable $e) { $step('Google profile refresh failed: ' . $e->getMessage()); lf_push_error($c, 'google', $e->getMessage()); }
  }
  // 2. Fast checks from listing data
  $c['activity'] = lf_assess_activity(['google' => $c['google'], 'websiteAudit' => null, 'manualActivity' => $c['manual']['activity'] ?? []], $s);
  $c['industryCheck'] = lf_assess_industry(['industryId' => $c['industryId'], 'category' => $c['category'], 'google' => $c['google'], 'name' => $c['name'], 'uploadIndustry' => $c['industry']], $s['industries']);
  $c['locationCheck'] = lf_assess_location(['google' => $c['google'], 'address' => $c['contact']['address'] ?? '', 'country' => $c['country'], 'city' => $c['city'], 'area' => $c['area']]);
  $c['sizeCheck'] = lf_assess_size(['google' => $c['google'], 'name' => $c['name']], $s, $ctx['chainCounts'] ?? []);
  // Keep duplicate records out of repeated network work, but do not stop at a
  // size/location/age signal. Website opportunity is the primary sales signal
  // for Comet HQ, so a record must be audited before its final category is set.
  $early = !empty($c['duplicateOf']);
  // 3. Website
  $siteUrl = lf_normalize_url($c['contact']['website'] ?? '');
  if ($offline && $siteUrl && !empty($c['websiteAudit'])) {
    $c['website'] = $c['website'] ?: ['url' => $siteUrl, 'domain' => lf_domain_of($siteUrl)];
    $c['websiteStatus'] = !empty($c['websiteAudit']['availability']['ok']) ? 'Working' : 'Not loading';
  } elseif ($siteUrl && !$early && !$offline) {
    $step('auditing website');
    $c['websiteAudit'] = lf_audit_website($siteUrl, ['pageSpeedKey' => $keys['pagespeed'], 'runPageSpeed' => !empty($s['runPageSpeed']) && empty($ctx['skipPageSpeed']), 'brokenLinkSample' => $s['brokenLinkSample'], 'city' => $c['city'], 'industryId' => $c['industryId']]);
    $fu = ($c['websiteAudit']['finalUrl'] ?? '') ?: $siteUrl;
    $c['website'] = ['url' => $fu, 'domain' => lf_domain_of($fu)];
    $c['websiteStatus'] = !empty($c['websiteAudit']['availability']['ok']) ? 'Working' : 'Not loading';
    foreach ($c['websiteAudit']['page']['emails'] ?? [] as $e) { lf_set_contact($c, 'email', $e, 'Website: ' . $c['website']['domain']); break; }
    foreach ($c['websiteAudit']['page']['social'] ?? [] as $k => $v) if (empty($c['social'][$k])) $c['social'][$k] = $v;
  } elseif ($siteUrl) {
    $c['website'] = ['url' => $siteUrl, 'domain' => lf_domain_of($siteUrl)]; $c['websiteStatus'] = 'Not checked';
  } else {
    $c['website'] = null; $c['websiteAudit'] = null;
    $c['websiteStatus'] = !empty($c['manual']['noWebsiteConfirmed']) ? 'Confirmed none' : 'Not found';
  }
  // 4. Age
  if (!$early && !$offline) {
    $domain = $c['website']['domain'] ?? '';
    $fresh = fn($x) => $x && lf_ts($x['checkedAt'] ?? '') && (microtime(true) - lf_ts($x['checkedAt'])) / 86400 < 30;
    if ($domain) {
      if (!$fresh($c['ageSources']['rdap'] ?? null) || ($c['ageSources']['rdap']['domain'] ?? null) !== lf_registrable_domain($domain)) { $step('checking domain registration'); $c['ageSources']['rdap'] = lf_rdap_registration($domain); }
      if (!$fresh($c['ageSources']['wayback'] ?? null) || ($c['ageSources']['waybackDomain'] ?? null) !== $domain) { $step('checking website history'); $c['ageSources']['wayback'] = lf_wayback_first_capture($domain); $c['ageSources']['waybackDomain'] = $domain; }
    }
  }
  $c['age'] = lf_assess_age(['manual' => $c['manual']['establishment'] ?? null, 'rdap' => $c['ageSources']['rdap'] ?? null, 'wayback' => $c['ageSources']['wayback'] ?? null, 'reviews' => $c['google']['reviews'] ?? [], 'hasWebsite' => !empty($c['website'])], $s);
  // 5. Activity again, now including the website result
  $c['activity'] = lf_assess_activity(['google' => $c['google'], 'websiteAudit' => $c['websiteAudit'] ?? null, 'manualActivity' => $c['manual']['activity'] ?? []], $s);
  // 6. Google Business + reviews
  $c['reviewAnalysis'] = lf_analyze_reviews($c['google'], $s);
  $c['gbpAudit'] = lf_audit_gbp($c['google'], ['industryId' => $c['industryId'], 'websiteKnown' => !empty($c['website']) && $c['websiteStatus'] === 'Working', 'websiteUrl' => $c['website']['url'] ?? '', 'reviewAnalysis' => $c['reviewAnalysis']], $s);
  // 7. Issues, services, validation, score, pitch
  $issues = array_merge($c['gbpAudit']['issues'] ?? [], $c['websiteAudit']['issues'] ?? []);
  if ($c['websiteStatus'] === 'Not found' && !array_filter($issues, fn($i) => $i['id'] === 'gbp-no-website'))
    $issues[] = ['id' => 'no-website-found', 'area' => 'website', 'status' => LF_POTENTIAL, 'title' => 'No website found', 'detail' => 'No website in the uploaded data or Google profile. Not proof that none exists.', 'services' => ['Website design', 'Website development'], 'evidence' => 'Checked sources', 'checkedAt' => lf_now_iso()];
  if ($c['websiteStatus'] === 'Confirmed none')
    $issues[] = ['id' => 'no-website-confirmed', 'area' => 'website', 'status' => LF_CONFIRMED, 'title' => 'Business has no website', 'detail' => ($c['manual']['noWebsiteNote'] ?? '') ?: 'Confirmed by the team.', 'services' => ['Website design', 'Website development', 'Branding'], 'evidence' => 'Team verification', 'checkedAt' => $c['manual']['noWebsiteAt'] ?? null];
  $c['issues'] = $issues;
  $c['services'] = lf_recommend_services($c, $s);
  $c['validation'] = lf_validate($c, $s);
  $c['score'] = lf_score($c, $s);
  $c['pitch'] = lf_generate_pitches($c, $s);
  $c['lastVerifiedAt'] = lf_now_iso();
  $c['partial'] = $early;
  // 8. Pipeline transfer (qualified only). Existing pipeline work is never discarded.
  $cat = $c['validation']['category'];
  if ($cat === 'Qualified' && empty($c['pipeline']['inPipeline']) && empty($c['demo']) && ($s['autoAddToPipeline'] ?? true)) {   // demo data never enters the pipeline
    $c['pipeline']['inPipeline'] = true; $c['pipeline']['stage'] = 'New'; $c['pipeline']['transferredAt'] = lf_now_iso();
    $c['pipeline']['history'][] = ['at' => lf_now_iso(), 'event' => 'Added to the Canvass pipeline after validation', 'stage' => 'New'];
  }
  $c['pipeline']['validationWarning'] = !empty($c['pipeline']['inPipeline']) && $cat !== 'Qualified' ? "Latest validation: $cat" : '';
  $c['auditHistory'] = array_slice(array_merge($c['auditHistory'] ?? [], [['at' => lf_now_iso(), 'category' => $cat, 'score' => $c['score']['total'], 'issues' => count($c['issues'])]]), -20);
  $step("$cat · score {$c['score']['total']}");
  return $c;
}

/** Store a processed company and, when it is in the pipeline, make sure it exists as a Canvass business. */
function lf_save(array &$c, ?string $by = null): void { lf_company_put($c); if (!empty($c['pipeline']['inPipeline']) && empty($c['pipeline']['hqId']) && empty($c['demo'])) lf_hq_transfer($c, $by); }

/* ================= Canvass (Pitch HQ) hand-off ================= */
const LF_HQ_SIGNALS = ['noweb' => 3, 'oldweb' => 2, 'fewrev' => 2, 'lowrate' => 2, 'noig' => 2, 'fewpic' => 1, 'stale' => 1, 'noreply' => 1, 'noinfo' => 1];
function lf_hq_signals(array $c): array {
  $ids = array_column($c['issues'] ?? [], 'status', 'id'); $has = fn($id, $conf = false) => isset($ids[$id]) && (!$conf || $ids[$id] === LF_CONFIRMED);
  $s = [];
  if (in_array($c['websiteStatus'] ?? '', ['Not found', 'Confirmed none'], true)) $s[] = 'noweb';
  elseif ($has('site-down') || $has('no-viewport') || $has('no-https') || $has('ps-performance', true) || $has('stale-footer')) $s[] = 'oldweb';
  if ($has('gbp-no-reviews') || $has('gbp-low-reviews')) $s[] = 'fewrev';
  if ($has('gbp-low-rating')) $s[] = 'lowrate';
  if (empty($c['social']['instagram']) && empty($c['websiteAudit']['page']['social']['instagram'])) $s[] = 'noig';
  if ($has('gbp-no-photos') || $has('gbp-few-photos')) $s[] = 'fewpic';
  if ($has('gbp-no-recent-reviews')) $s[] = 'stale';
  if ($has('gbp-no-hours') || $has('gbp-no-phone')) $s[] = 'noinfo';
  return $s;
}
function lf_hq_category(array $c): string {
  $t = mb_strtolower(implode(' ', array_merge([$c['name'] ?? '', $c['google']['primaryType'] ?? '', $c['industry'] ?? ''], $c['google']['types'] ?? [])));
  if (preg_match('/gym|fitness|yoga|martial|pilates/', $t)) return 'Gym & fitness';
  if (preg_match('/hotel|hostel|resort|lodging/', $t)) return 'Hospitality';
  $m = ['restaurants-cafes' => preg_match('/caf[eé]|coffee/', $t) ? 'Café' : 'Restaurant', 'healthcare' => 'Clinic', 'beauty-spa' => 'Salon & spa', 'fashion-retail' => 'Retail', 'ecommerce' => 'Retail',
    'automobile' => 'Auto', 'real-estate' => 'Real estate', 'construction' => 'Home services', 'interior-design' => 'Home services', 'professional-services' => 'Services', 'it-services' => 'Services',
    'logistics' => 'Services', 'manufacturing' => 'Services', 'education' => 'Services'];
  if (isset($m[$c['industryId'] ?? ''])) return $m[$c['industryId']];
  foreach ([['/dent|clinic|physio|medical|doctor/', 'Clinic'], ['/caf[eé]|coffee/', 'Café'], ['/restaurant|bakery|food|grill/', 'Restaurant'], ['/salon|barber|spa|nail|beauty|hair/', 'Salon & spa'], ['/car|auto|garage/', 'Auto'], ['/real estate|property/', 'Real estate'], ['/shop|store|boutique|florist/', 'Retail'], ['/clean|repair|contractor|plumb|electric/', 'Home services']] as [$re, $v]) if (preg_match($re, $t)) return $v;
  return 'Other';
}
function lf_hq_services(array $c): array {
  $out = [];
  foreach ($c['services'] ?? [] as $s) {
    $n = $s['name'];
    if (preg_match('/^(Branding|Graphic design)$/', $n)) $out['branding'] = 1;
    elseif (preg_match('/Social media|Content planning|Video and reels|Creative content/', $n)) $out['social'] = 1;
    elseif (preg_match('/Ads|advertising|Lead generation/', $n)) $out['ads'] = 1;
    elseif (preg_match('/photography/', $n)) $out['photo'] = 1;
    elseif (($s['group'] ?? '') === 'search') $out['seo'] = 1;
    elseif (($s['group'] ?? '') === 'website') $out['website'] = 1;
  }
  return array_keys($out);
}
const LF_V1_STAGE = ['New' => 'lead', 'Contacted' => 'pitched', 'Follow-up' => 'followup', 'Proposal sent' => 'pitched', 'Negotiation' => 'followup', 'Won' => 'won', 'Lost' => 'lost'];
function lf_system_user(?string $by): string {
  if ($by) return $by;
  return (string) (db()->query('SELECT id FROM users WHERE is_admin=1 AND active=1 ORDER BY joined_at LIMIT 1')->fetchColumn() ?: 'lead-finder');
}
/** Create the Canvass business for a qualified lead (once). Lead Finder's findings go into notes; Google content is not copied. */
function lf_hq_transfer(array &$c, ?string $by = null): ?string {
  if (!empty($c['pipeline']['hqId']) && getBiz($c['pipeline']['hqId'])) return $c['pipeline']['hqId'];
  foreach (db()->query('SELECT id,data FROM businesses') as $r) {              // already there (linked, or added by hand with the same name)
    $b = json_decode($r['data'], true);
    if (($b['lfId'] ?? '') === $c['id'] || (lf_norm_name($b['name'] ?? '') !== '' && lf_norm_name($b['name'] ?? '') === lf_norm_name($c['name']))) {
      if (empty($b['lfId'])) { $b['lfId'] = $c['id']; putBiz($r['id'], $b); bump(); }
      $c['pipeline']['hqId'] = $r['id']; lf_company_put($c); return $r['id'];
    }
  }
  $sig = lf_hq_signals($c); $pts = 0; foreach ($sig as $k) $pts += LF_HQ_SIGNALS[$k];
  $conf = array_values(array_filter($c['issues'] ?? [], fn($i) => $i['status'] === LF_CONFIRMED));
  $pot = array_values(array_filter($c['issues'] ?? [], fn($i) => $i['status'] !== LF_CONFIRMED));
  $notes = "From Lead Finder · score {$c['score']['total']}/100 (" . ($c['score']['priority'] ?? '') . ' priority) · verified ' . substr((string) ($c['lastVerifiedAt'] ?? ''), 0, 10) . "\n"
    . ($conf ? "Confirmed findings:\n" . implode("\n", array_map(fn($i) => '• ' . $i['title'] . (!empty($i['detail']) ? ' — ' . $i['detail'] : ''), array_slice($conf, 0, 8))) . "\n" : '')
    . ($pot ? 'Also worth checking: ' . implode('; ', array_map(fn($i) => $i['title'], array_slice($pot, 0, 6))) . "\n" : '')
    . ($c['services'] ? 'Suggested services: ' . implode(', ', array_map(fn($s) => $s['name'], array_slice($c['services'], 0, 6))) : '');
  $who = lf_system_user($by); $t = nowMs(); $v1 = $c['pipeline']['stage'] ?? '';
  $status = LF_V1_STAGE[$v1] ?? 'lead';
  $doc = ['name' => mb_substr($c['name'], 0, 120), 'category' => lf_hq_category($c), 'area' => mb_substr(($c['area'] ?? '') ?: ($c['city'] ?? ''), 0, 80),
    'phone' => mb_substr((string) ($c['contact']['phone'] ?? ''), 0, 60), 'website' => mb_substr((string) ($c['contact']['website'] ?? ''), 0, 300), 'instagram' => mb_substr((string) ($c['social']['instagram'] ?? ''), 0, 200),
    'address' => mb_substr((string) ($c['contact']['address'] ?? ''), 0, 600), 'services' => lf_hq_services($c), 'priority' => $pts >= 7 ? 'hot' : ($pts >= 4 ? 'warm' : 'cold'), 'score' => $pts, 'signals' => $sig,
    'value' => null, 'status' => $status, 'ownerId' => null, 'helpers' => [], 'assets' => [], 'activities' => [], 'notes' => mb_substr($notes, 0, 4000),
    'google' => ['mapsUrl' => !empty($c['google']['placeId']) ? 'https://www.google.com/maps/place/?q=place_id:' . $c['google']['placeId'] : ''],
    'lfId' => $c['id'], 'lfScore' => $c['score']['total'] ?? null, 'nextStep' => '', 'nextDate' => (string) ($c['pipeline']['followUpDate'] ?? ''),
    'createdBy' => $who, 'createdAt' => $t, 'updatedAt' => $t, 'log' => [['by' => $who, 'at' => $t, 't' => 'added it from Lead Finder']]];
  if ($status === 'won') $doc['wonAt'] = $t;
  if (in_array($status, ['pitched', 'followup', 'won'], true)) $doc['pitchedAt'] = $t;
  $id = gid(); putBiz($id, $doc); bump();
  $c['pipeline']['hqId'] = $id; $c['pipeline']['history'][] = ['at' => lf_now_iso(), 'event' => 'Added to the Canvass pipeline'];
  lf_company_put($c);
  return $id;
}
/** Link a business that was added by hand (Quick add) to its Lead Finder report. */
function lf_link_hq(array &$c, string $hqId): void {
  $b = getBiz($hqId); if (!$b) return;
  $b['lfId'] = $c['id']; $b['lfScore'] = $c['score']['total'] ?? null; $b['updatedAt'] = nowMs();
  $b['log'] = array_slice(array_merge($b['log'] ?? [], [['by' => lf_system_user(null), 'at' => nowMs(), 't' => 'Lead Finder checked it: ' . lf_cat($c)]]), -40);
  putBiz($hqId, $b); bump();
  $c['pipeline']['hqId'] = $hqId; lf_company_put($c);
}
/** After the Google retention period, remove Google-only contact details that were copied to the Canvass business (unless changed since). */
function lf_hq_scrub_google(string $hqId, array $removed): void {
  $b = getBiz($hqId); if (!$b) return; $ch = false;
  foreach (['phone' => 'phone', 'address' => 'address', 'website' => 'website'] as $lfField => $hqField)
    if (isset($removed[$lfField]) && ($b[$hqField] ?? '') === mb_substr((string) $removed[$lfField], 0, $hqField === 'address' ? 600 : ($hqField === 'phone' ? 60 : 300))) { $b[$hqField] = ''; $ch = true; }
  if ($ch) { $b['updatedAt'] = nowMs(); putBiz($hqId, $b); bump(); }
}
/** Pipeline numbers for the Lead Finder dashboard come from the Canvass businesses linked to Lead Finder. */
function lf_hq_linked(): array { $out = []; foreach (db()->query('SELECT id,data FROM businesses') as $r) { $b = json_decode($r['data'], true); if (!empty($b['lfId'])) $out[$b['lfId']] = ['id' => $r['id']] + $b; } return $out; }

/* ================= jobs ================= */
function lf_job_get(string $id): ?array { $st = db()->prepare('SELECT data FROM lf_jobs WHERE id=?'); $st->execute([$id]); $d = $st->fetchColumn(); return $d ? json_decode($d, true) : null; }
function lf_job_put(array $j): void {
  $j['log'] = array_slice($j['log'] ?? [], -300);
  db()->prepare('INSERT INTO lf_jobs(id,status,data,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data,updated_at=excluded.updated_at')->execute([$j['id'], $j['status'], lf_json($j), $j['createdAt'], lf_now_iso()]);
  db()->exec("DELETE FROM lf_jobs WHERE id NOT IN (SELECT id FROM lf_jobs ORDER BY created_at DESC LIMIT 300) AND status NOT IN ('queued','running')");
}
function lf_job_public(array $j, bool $withLog = true): array { unset($j['work']); if (!$withLog) unset($j['log']); $j['cancelRequested'] = !empty($j['cancelRequested']) || lf_cancel_requested($j['id']); return $j; }
function lf_jobs_list(int $n = 50): array { $out = []; foreach (db()->query('SELECT data FROM lf_jobs ORDER BY created_at DESC LIMIT ' . $n) as $r) $out[] = lf_job_public(json_decode($r['data'], true), false); return $out; }
function lf_enqueue(string $type, array $params, array $work): array {
  $j = ['id' => lf_new_id('job'), 'type' => $type, 'params' => $params, 'status' => 'queued', 'createdAt' => lf_now_iso(), 'progress' => ['done' => 0, 'total' => $work['total'] ?? 0, 'phase' => 'Queued'], 'counts' => [], 'log' => [], 'work' => $work];
  lf_job_put($j); return $j;
}
function lf_cancel_requested(string $id): bool { return (bool) lf_kv_get('cancel:' . $id, false); }
function lf_job_cancel(string $id): bool {
  $j = lf_job_get($id); if (!$j || !in_array($j['status'], ['queued', 'running'], true)) return false;
  if ($j['status'] === 'queued') { $j['status'] = 'cancelled'; $j['finishedAt'] = lf_now_iso(); $j['progress']['phase'] = 'cancelled'; lf_job_put($j); return true; }
  lf_kv_set('cancel:' . $id, true); return true;
}
function lf_tally(array &$job, array $c): void { $k = $c['validation']['category'] ?? 'Unprocessed'; $job['counts'][$k] = ($job['counts'][$k] ?? 0) + 1; }
function lf_job_log(array &$job, string $m): void { $job['log'][] = gmdate('H:i:s') . ' ' . $m; if (count($job['log']) > 400) array_shift($job['log']); }
function lf_dup_count(array &$job): void { $job['counts']['Duplicates'] = ($job['counts']['Duplicates'] ?? 0) + 1; }

/* ---------- Module A: Google automatic lead finder ---------- */
function lf_discovery_queries(array $p, array $industries): array {
  $ind = null; foreach ($industries as $i) if ($i['id'] === $p['industryId']) $ind = $i;
  $terms = array_values(array_filter(array_merge([$p['category'] ?? ''], ($p['category'] ?? '') ? [] : array_merge([$ind['name'] ?? ''], array_slice($ind['keywords'] ?? [], 0, 4))), 'strlen'));
  $where = implode(', ', array_filter([$p['area'] ?? '', $p['city'] ?? '', $p['country'] ?? ''], 'strlen'));
  return array_values(array_unique(array_map(fn($t) => "$t in $where", $terms)));
}
function lf_start_discovery(array $params, ?string $by = null): array {
  $s = lf_settings();
  $p = ['country' => trim((string) (($params['country'] ?? '') ?: $s['defaultCountry'])), 'city' => trim((string) ($params['city'] ?? '')), 'area' => trim((string) ($params['area'] ?? '')),
    'industryId' => (string) ($params['industryId'] ?? ''), 'category' => trim((string) ($params['category'] ?? '')), 'count' => max(1, min(200, (int) ($params['count'] ?? 10) ?: 10)), 'scheduleId' => $params['scheduleId'] ?? null, 'by' => $by];
  if ($p['city'] === '') throw new HttpFail('Choose a city.');
  if ($p['industryId'] === '') throw new HttpFail('Choose an industry.');
  if (!lf_effective_key($s, 'googlePlacesKey')) throw new HttpFail('Add a Google Places API key in Lead Finder → Settings to use automatic discovery. Bulk Upload works without it.');
  $b = lf_budget_status();
  if ($b['enabled'] && ($b['remaining'] <= 0 || $b['dayRemaining'] <= 0)) throw new HttpFail("Google Places free-tier limit reached ({$b['used']}/{$b['limit']} this month, {$b['dayUsed']}/{$b['dayLimit']} today). No requests were made.");
  $queries = lf_discovery_queries($p, $s['industries']);
  return lf_enqueue('discovery', $p, ['phase' => 'search', 'queries' => $queries, 'qi' => 0, 'page' => 0, 'token' => '', 'found' => [], 'maxCandidates' => min($s['maxCandidatesPerSearch'], max($p['count'] * 6, 20)), 'ci' => 0, 'qualified' => 0]);
}

/* ---------- Module B: bulk lead finder ---------- */
const LF_FIELD_ALIASES = [
  'name' => ['company', 'companyname', 'business', 'businessname', 'name', 'tradename', 'organisation', 'organization'],
  'website' => ['website', 'websiteurl', 'url', 'site', 'domain', 'web', 'websitelink', 'link'],
  'phone' => ['phone', 'phonenumber', 'telephone', 'mobile', 'contactnumber', 'tel'],
  'email' => ['email', 'emailaddress', 'companyemail', 'contactemail'],
  'address' => ['address', 'businessaddress', 'location', 'fulladdress'],
  'city' => ['city', 'emirate', 'town'], 'area' => ['area', 'district', 'neighbourhood', 'neighborhood'], 'country' => ['country'],
  'industry' => ['industry', 'category', 'sector', 'businesscategory', 'businesstype'],
  'mapsLink' => ['googlemapslink', 'mapslink', 'googlemaps', 'mapsurl', 'gmb', 'googlebusiness', 'maplink'],
  'instagram' => ['instagram', 'instagramurl'], 'linkedin' => ['linkedin', 'linkedinurl'], 'facebook' => ['facebook', 'facebookurl'],
  'establishedDate' => ['establisheddate', 'establishmentdate', 'founded', 'foundeddate', 'licenseissuedate', 'licenceissuedate', 'registrationdate', 'incorporationdate'],
  'establishedSource' => ['establishedsource', 'licensesource', 'registrationsource'],
];
/** Turn uploaded table rows or pasted lines into normalised rows. */
function lf_normalize_bulk_input(array $in): array {
  $out = []; $rows = $in['rows'] ?? null;
  if (is_array($rows) && $rows) {
    $header = array_map(fn($h) => preg_replace('/[^a-z0-9]/', '', strtolower((string) $h)), (array) $rows[0]);
    $known = false; foreach (LF_FIELD_ALIASES as $aliases) if (array_intersect($header, $aliases)) $known = true;
    foreach ($known ? array_slice($rows, 1) : $rows as $r) {
      if (!is_array($r) || !array_filter($r, fn($v) => trim((string) $v) !== '')) continue;
      $row = [];
      if ($known) { foreach (LF_FIELD_ALIASES as $field => $aliases) { foreach ($header as $i => $h) if (in_array($h, $aliases, true)) { if (trim((string) ($r[$i] ?? '')) !== '') $row[$field] = trim((string) $r[$i]); break; } } }
      else { $first = ''; foreach ($r as $v) if (trim((string) $v) !== '') { $first = (string) $v; break; } $row = lf_classify_line($first); }
      if (!empty($row['website']) && lf_is_maps_link($row['website'])) { $row['mapsLink'] = $row['website']; unset($row['website']); }
      if (!empty($row['name']) || !empty($row['website']) || !empty($row['mapsLink'])) $out[] = $row;
    }
  }
  if (!empty($in['text'])) foreach (preg_split('/\r?\n/', (string) $in['text']) as $line) { $l = trim($line); if ($l !== '') $out[] = lf_classify_line($l); }
  return array_slice($out, 0, 2000);
}
function lf_classify_line(string $l): array {
  $l = trim($l);
  if (lf_is_maps_link($l)) return ['mapsLink' => preg_match('#^https?:#i', $l) ? $l : 'https://' . $l];
  if (preg_match('#^(https?://)?([\w-]+\.)+[a-z]{2,}(/\S*)?$#i', $l)) return lf_is_social_url($l) ? ['name' => '', 'instagram' => $l] : ['website' => $l];
  return ['name' => $l];
}
function lf_resolve_google(array &$row, string $key, array $p, callable $log): ?array {
  if ($key === '') return null;
  try {
    if (!empty($row['mapsLink'])) {
      $link = $row['mapsLink'];
      if (preg_match('#maps\.app\.goo\.gl|goo\.gl/maps#i', $link)) { $r = LfHttp::fetch($link, ['api' => 'website', 'guard' => true, 'timeout' => 15, 'retries' => 1, 'maxBytes' => 65536]); $link = $r['finalUrl']; }
      $ref = lf_parse_maps_link($link);
      if (!empty($ref['placeId'])) return lf_google_block(lf_place_details($key, $ref['placeId']));
      if (!empty($ref['name']) && empty($row['name'])) $row['name'] = $ref['name'];
    }
    $where = implode(', ', array_filter([($row['city'] ?? '') ?: $p['city'], ($row['country'] ?? '') ?: $p['country']], 'strlen'));
    $domain = lf_domain_of($row['website'] ?? '');
    $query = !empty($row['name']) ? $row['name'] . ($where ? ' ' . $where : '') : $domain;
    if ($query === '') return null;
    $r = lf_text_search($key, ['textQuery' => $query, 'pageSize' => 5, 'regionCode' => lf_region_code(($row['country'] ?? '') ?: $p['country'])]);
    $best = null; $bestKey = null;
    foreach ($r['places'] as $pl) {
      $sim = !empty($row['name']) ? lf_name_similarity($row['name'], $pl['displayName']['text'] ?? '') : 0;
      $dom = $domain !== '' && lf_domain_of($pl['websiteUri'] ?? '') === $domain;
      if (!$dom && $sim < 0.6) continue;
      $k = [(int) $dom, $sim]; if ($best === null || $k > $bestKey) { $best = $pl; $bestKey = $k; }
    }
    if (!$best) { $log((($row['name'] ?? '') ?: $domain) . ': no confident Google Business match'); return null; }
    return lf_google_block($best);
  } catch (ApiError $e) {
    if ($e->errCode === 'BUDGET') throw $e;
    $log((($row['name'] ?? '') ?: (($row['website'] ?? '') ?: 'row')) . ': Google lookup failed — ' . $e->getMessage()); return null;
  } catch (Throwable $e) { $log((($row['name'] ?? '') ?: 'row') . ': Google lookup failed — ' . $e->getMessage()); return null; }
}
function lf_start_bulk(array $params, ?string $by = null): array {
  $rows = lf_normalize_bulk_input(['rows' => $params['rows'] ?? null, 'text' => $params['text'] ?? '']);
  if (!$rows) throw new HttpFail('No companies found in the upload. Include a company name, website or Google Maps link column.');
  $p = ['country' => trim((string) ($params['country'] ?? '')), 'city' => trim((string) ($params['city'] ?? '')), 'industryId' => (string) ($params['industryId'] ?? ''), 'fileName' => mb_substr((string) (($params['fileName'] ?? '') ?: 'Pasted list'), 0, 120), 'rows' => count($rows), 'legacy' => !empty($params['legacy']), 'quick' => !empty($params['quick']), 'linkHq' => (isset($params['linkHq']) && is_string($params['linkHq']) && getBiz($params['linkHq'])) ? $params['linkHq'] : null, 'by' => $by];
  return lf_enqueue('bulk', $p, ['phase' => 'dedupe', 'rows' => $rows, 'ri' => 0, 'total' => count($rows)]);
}
function lf_start_refresh(array $ids, ?string $by = null): array { return lf_enqueue('refresh', ['ids' => count($ids), 'by' => $by], ['ids' => array_values($ids), 'ri' => 0, 'total' => count($ids)]); }

function lf_legacy_rows(): array {
  foreach ([dirname(__DIR__, 3) . '/legacy/analyzed-leads-data.js', dataDir() . '/legacy/analyzed-leads-data.js'] as $file) {
    if (!is_file($file)) continue;
    $txt = preg_replace('/^\xEF\xBB\xBF/', '', (string) file_get_contents($file));
    $list = json_decode(substr($txt, strpos($txt, '['), strrpos($txt, ']') - strpos($txt, '[') + 1), true) ?: [];
    return array_merge([['company', 'website', 'phone', 'email', 'address', 'industry', 'instagram', 'linkedin']], array_map(fn($x) => [$x['name'] ?? '', $x['website'] ?? '', $x['phone'] ?? '', $x['email'] ?? '', $x['address'] ?? '', $x['industry'] ?? '', $x['instagram'] ?? '', $x['linkedin'] ?? ''], $list));
  }
  throw new HttpFail('The earlier list (legacy/analyzed-leads-data.js) is not on this server. Upload it through Bulk upload instead.');
}

/** One unit of work. Returns false when the job has nothing left to do. */
function lf_job_step(array &$job): bool {
  $s = lf_settings(); $w = &$job['work']; $p = $job['params']; $by = $p['by'] ?? null;
  $log = function ($m) use (&$job) { lf_job_log($job, $m); };
  $cancel = lf_cancel_requested($job['id']) && empty($job['reachedTarget']);
  $ind = null; foreach ($s['industries'] as $i) if ($i['id'] === ($p['industryId'] ?? '')) $ind = $i;

  if ($job['type'] === 'discovery') {
    if ($w['phase'] === 'search') {
      $key = lf_effective_key($s, 'googlePlacesKey');
      $job['progress']['phase'] = 'Searching Google Places';
      $q = $w['queries'][$w['qi']] ?? null;
      if ($q === null || count($w['found']) >= $w['maxCandidates'] || $cancel || !empty($job['budgetStopped'])) {
        if (!empty($job['budgetStopped']) && !$w['found']) throw new RuntimeException($job['budgetStopped']);
        $log(count($w['found']) . ' candidate businesses found');
        $chain = []; foreach ($w['found'] as $pl) { $n = lf_norm_name($pl['displayName']['text'] ?? ''); $chain[$n] = ($chain[$n] ?? 0) + 1; }
        $w['chainCounts'] = $chain; $w['candidates'] = array_values($w['found']); $w['found'] = []; $w['phase'] = 'process'; $w['ci'] = 0;
        $job['progress'] = ['done' => 0, 'total' => count($w['candidates']), 'phase' => 'Verifying and auditing'];
        return true;
      }
      $log("Search \"$q\" page " . ($w['page'] + 1));
      try { $r = lf_text_search($key, ['textQuery' => $q, 'pageToken' => $w['token'], 'pageSize' => 20, 'regionCode' => lf_region_code($p['country'])]); }
      catch (ApiError $e) { if ($e->errCode !== 'BUDGET') throw $e; $log($e->getMessage()); $job['budgetStopped'] = $e->getMessage(); return true; }
      foreach ($r['places'] as $pl) if (!isset($w['found'][$pl['id']]) && count($w['found']) < $w['maxCandidates']) $w['found'][$pl['id']] = $pl;
      $job['progress']['total'] = count($w['found']);
      $w['token'] = $r['nextPageToken']; $w['page']++;
      if (!$w['token'] || $w['page'] >= 3) { $w['qi']++; $w['page'] = 0; $w['token'] = ''; }
      else LfHttp::pause(300);
      return true;
    }
    // process phase
    if ($cancel || !empty($job['reachedTarget']) || $w['ci'] >= count($w['candidates'])) {
      if (!empty($job['budgetStopped'])) $job['note'] = 'Stopped early: ' . $job['budgetStopped'];
      lf_add_search(['id' => $job['id'], 'at' => $job['startedAt'] ?? $job['createdAt'], 'type' => 'Google discovery', 'params' => $p, 'status' => 'done', 'finishedAt' => lf_now_iso(), 'candidates' => count($w['candidates']), 'processed' => $job['progress']['done'], 'counts' => $job['counts']]);
      $log('Finished'); return false;
    }
    $pl = $w['candidates'][$w['ci']++];
    $g = lf_google_block($pl);
    $c = lf_new_record(['name' => $g['displayName'], 'industryId' => $p['industryId'], 'industryName' => $ind['name'] ?? '', 'category' => $p['category'], 'country' => $p['country'], 'city' => $p['city'], 'area' => $p['area'],
      'source' => ['type' => 'google', 'detail' => 'Google Places search: ' . (($p['category'] ?: ($ind['name'] ?? ''))) . ' in ' . implode(', ', array_filter([$p['area'], $p['city']], 'strlen')), 'searchId' => $job['id'], 'by' => $by, 'at' => lf_now_iso()]]);
    lf_merge_google($c, $g);
    $dup = lf_find_duplicate($c);
    if ($dup) { lf_log_duplicate(['name' => $c['name'], 'matchedId' => $dup['match']['id'], 'matchedName' => $dup['match']['name'], 'by' => $dup['by'], 'source' => 'Google discovery', 'jobId' => $job['id']]); lf_dup_count($job); $log("{$c['name']}: duplicate of existing record ({$dup['by']}) — skipped"); }
    else {
      lf_process_company($c, ['settings' => $s, 'chainCounts' => $w['chainCounts'], 'log' => $log]);
      lf_save($c, $by); lf_tally($job, $c);
      if ($c['validation']['category'] === 'Qualified') $w['qualified']++;
    }
    $job['progress']['done']++;
    if ($w['qualified'] >= $p['count'] && empty($job['reachedTarget'])) { $job['reachedTarget'] = true; $log("Target of {$p['count']} qualified leads reached"); }
    return true;
  }

  if ($job['type'] === 'bulk') {
    $key = lf_effective_key($s, 'googlePlacesKey');
    if ($w['phase'] === 'dedupe') {
      if (!$key) $log('No Google Places key — Google Business checks are skipped; affected companies will stay Unverified.');
      $job['progress'] = ['done' => 0, 'total' => count($w['rows']), 'phase' => 'Processing upload'];
      $chain = []; foreach ($w['rows'] as $r) { $n = lf_norm_name($r['name'] ?? ''); if ($n !== '') $chain[$n] = ($chain[$n] ?? 0) + 1; }
      $seen = []; $unique = [];                    // de-duplicate inside the upload first
      foreach ($w['rows'] as $r) {
        $d = lf_domain_of($r['website'] ?? ''); $n = str_replace(' ', '', lf_norm_name($r['name'] ?? ''));
        $keys = array_values(array_filter([$d ? 'd:' . $d : '', $d ? 'n:' . preg_replace('/[^a-z0-9]/', '', explode('.', $d)[0]) : '', strlen($n) >= 5 ? 'n:' . $n : '', !empty($r['mapsLink']) ? 'm:' . $r['mapsLink'] : '']));
        $hit = null; foreach ($keys as $k) if (isset($seen[$k])) { $hit = $seen[$k]; break; }
        $label = ($r['name'] ?? '') ?: ($d ?: ($r['mapsLink'] ?? ''));
        if ($hit) { lf_log_duplicate(['name' => $label, 'matchedId' => '', 'matchedName' => $hit, 'by' => 'repeated in the same upload', 'source' => $p['fileName'], 'jobId' => $job['id']]); lf_dup_count($job); continue; }
        foreach ($keys as $k) $seen[$k] = $label; $unique[] = $r;
      }
      $w['rows'] = $unique; $w['chainCounts'] = $chain; $w['phase'] = 'process'; $w['ri'] = 0; $job['progress']['total'] = count($unique);
      return true;
    }
    if ($cancel || $w['ri'] >= count($w['rows'])) {
      lf_add_search(['id' => $job['id'], 'at' => $job['startedAt'] ?? $job['createdAt'], 'type' => $p['legacy'] ? 'Legacy import' : ($p['quick'] ? 'Quick add' : 'Bulk upload'), 'params' => $p, 'status' => 'done', 'finishedAt' => lf_now_iso(), 'candidates' => $p['rows'], 'processed' => $job['progress']['done'], 'counts' => $job['counts']]);
      $log('Finished'); return false;
    }
    $row = $w['rows'][$w['ri']++];
    $google = null;
    try { $google = lf_resolve_google($row, $key, $p, $log); }
    catch (ApiError $e) { $log((($row['name'] ?? '') ?: 'row') . ': ' . $e->getMessage()); $job['note'] = 'Google checks stopped: ' . $e->getMessage(); }
    $c = lf_new_record(['name' => ($row['name'] ?? '') ?: (($google['displayName'] ?? '') ?: (lf_domain_of($row['website'] ?? '') ?: 'Unnamed business')), 'industryId' => $p['industryId'], 'industryName' => $ind['name'] ?? '', 'industry' => $row['industry'] ?? '',
      'country' => ($row['country'] ?? '') ?: $p['country'], 'city' => ($row['city'] ?? '') ?: $p['city'], 'area' => $row['area'] ?? '',
      'source' => ['type' => $p['legacy'] ? 'legacy' : ($p['quick'] ? 'quick' : 'bulk'), 'detail' => $p['fileName'], 'searchId' => $job['id'], 'by' => $by, 'at' => lf_now_iso()]]);
    $src = 'Upload: ' . $p['fileName'];
    if (!empty($row['website']) && !lf_is_social_url($row['website'])) lf_set_contact($c, 'website', lf_normalize_url($row['website']), $src);
    lf_set_contact($c, 'phone', $row['phone'] ?? '', $src); lf_set_contact($c, 'email', $row['email'] ?? '', $src); lf_set_contact($c, 'address', $row['address'] ?? '', $src);
    foreach (['instagram', 'linkedin', 'facebook'] as $k) if (!empty($row[$k])) $c['social'][$k] = $row[$k];
    if (!empty($row['establishedDate']) && lf_valid_date($row['establishedDate']) && !empty($row['establishedSource']))
      $c['manual']['establishment'] = ['date' => gmdate('Y-m-d', (int) lf_ts($row['establishedDate'])), 'source' => $row['establishedSource'], 'enteredAt' => lf_now_iso(), 'by' => 'Upload'];
    if ($google) lf_merge_google($c, $google);
    $dup = lf_find_duplicate($c);
    if ($dup) { lf_log_duplicate(['name' => $c['name'], 'matchedId' => $dup['match']['id'], 'matchedName' => $dup['match']['name'], 'by' => $dup['by'], 'source' => $p['fileName'], 'jobId' => $job['id']]); lf_dup_count($job); $log("{$c['name']}: duplicate ({$dup['by']}) — skipped"); }
    else { if (!empty($p['linkHq'])) $c['pipeline']['hqId'] = $p['linkHq']; lf_process_company($c, ['settings' => $s, 'chainCounts' => $w['chainCounts'], 'log' => $log]); lf_save($c, $by); if (!empty($p['linkHq'])) lf_link_hq($c, $p['linkHq']); lf_tally($job, $c); $job['lastCompanyId'] = $c['id']; }
    $job['progress']['done']++;
    return true;
  }

  if ($job['type'] === 'refresh') {
    $job['progress']['phase'] = 'Re-verifying';
    if ($cancel || $w['ri'] >= count($w['ids'])) { $log('Finished'); return false; }
    $c = lf_company_get($w['ids'][$w['ri']++]);
    if ($c) { lf_process_company($c, ['settings' => $s, 'refreshGoogle' => true, 'log' => $log]); lf_save($c, $by); lf_tally($job, $c); }
    $job['progress']['done']++;
    return true;
  }
  return false;
}

/* ---------- scheduled searches + maintenance ---------- */
function lf_run_schedules(): void {
  $s = lf_settings(); $changed = false;
  foreach ($s['schedules'] as &$sch) {
    if (empty($sch['enabled'])) continue;
    if (!empty($sch['lastRunAt']) && microtime(true) - lf_ts($sch['lastRunAt']) < $sch['everyHours'] * 3600) continue;
    $sch['lastRunAt'] = lf_now_iso(); $changed = true;
    try { lf_start_discovery(array_merge($sch['params'], ['scheduleId' => $sch['id']]), $sch['by'] ?? null); $sch['lastResult'] = 'Started'; }
    catch (Throwable $e) { $sch['lastResult'] = 'Not started: ' . $e->getMessage(); }
  }
  unset($sch);
  if ($changed) lf_settings_save($s);
}
function lf_maintenance(): void {
  $last = lf_kv_get('maintAt', 0); if (time() - $last < 55) return;
  lf_kv_set('maintAt', time());
  try { lf_run_schedules(); } catch (Throwable $e) { error_log('[canvass] schedules: ' . $e->getMessage()); }
  try { lf_purge_expired_google(); } catch (Throwable $e) { error_log('[canvass] purge: ' . $e->getMessage()); }
  $day = gmdate('Y-m-d');
  if (lf_kv_get('lastBackupDay', '') !== $day) { lf_kv_set('lastBackupDay', $day); try { lf_backup('auto'); } catch (Throwable $e) { error_log('[canvass] backup: ' . $e->getMessage()); } }
}

/** Do background work for up to $seconds. Only one worker runs at a time (lease lock). Returns what happened. */
function lf_tick(float $seconds = 20, string $mode = 'browser'): array {
  $pdo = db(); $me = bin2hex(random_bytes(6)); $lease = 300;
  // The local worker is long-lived; reload settings so newly saved API keys are used immediately.
  lf_settings(true);
  $pdo->exec('BEGIN IMMEDIATE');
  $lock = lf_kv_get('lock', null);
  if ($lock && ($lock['until'] ?? 0) > time()) { $pdo->exec('COMMIT'); return ['busy' => true]; }
  lf_kv_set('lock', ['until' => time() + $lease, 'owner' => $me]); $pdo->exec('COMMIT');
  lf_kv_set('worker', ['at' => time(), 'mode' => $mode]);
  @set_time_limit((int) $seconds + 240);
  lf_install_http_hooks();
  $start = microtime(true); $steps = 0;
  try {
    lf_maintenance();
    while (microtime(true) - $start < $seconds) {
      $row = $pdo->query("SELECT data FROM lf_jobs WHERE status IN ('running','queued') ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, created_at LIMIT 1")->fetchColumn();
      if (!$row) break;
      $job = json_decode($row, true);
      if ($job['status'] === 'queued') { $job['status'] = 'running'; $job['startedAt'] = lf_now_iso(); lf_job_log($job, 'Started'); }
      try {
        $more = lf_job_step($job);
        if (!$more) { $job['status'] = lf_cancel_requested($job['id']) && empty($job['reachedTarget']) ? 'cancelled' : 'done'; }
      } catch (Throwable $e) {
        $job['status'] = 'failed'; $job['error'] = $e->getMessage(); lf_job_log($job, 'Stopped: ' . $e->getMessage());
      }
      if ($job['status'] !== 'running') { $job['finishedAt'] = lf_now_iso(); $job['progress']['phase'] = $job['status']; unset($job['work']); db()->prepare('DELETE FROM lf_kv WHERE k=?')->execute(['cancel:' . $job['id']]); }
      lf_job_put($job); $steps++;
      lf_kv_set('lock', ['until' => time() + $lease, 'owner' => $me]); lf_kv_set('worker', ['at' => time(), 'mode' => $mode]);
    }
  } finally {
    $l = lf_kv_get('lock', null); if (($l['owner'] ?? '') === $me) db()->prepare('DELETE FROM lf_kv WHERE k=?')->execute(['lock']);
  }
  $pending = (int) $pdo->query("SELECT COUNT(*) FROM lf_jobs WHERE status IN ('running','queued')")->fetchColumn();
  return ['steps' => $steps, 'pending' => $pending];
}
