<?php
/* Lead Finder · dashboard statistics and export tables — always computed from stored, processed records. */
declare(strict_types=1);

const LF_HQ_STAGES = ['lead' => 'Spotted', 'claimed' => 'Claimed', 'drafting' => 'Building pitch', 'pitched' => 'Pitched', 'followup' => 'Follow-up', 'won' => 'Won', 'lost' => 'Passed'];

function lf_website_group(string $id): string {
  if (preg_match('/^ps-performance|slow|site-down/', $id)) return 'Performance & availability';
  if (preg_match('/https|redirect/', $id)) return 'Security (HTTPS)';
  if (preg_match('/title|meta|h1|canonical|sitemap|noindex|ps-seo/', $id)) return 'Technical SEO';
  if (preg_match('/enquiry|form|whatsapp|cta/', $id)) return 'Enquiries & conversion';
  if (preg_match('/local|address/', $id)) return 'Local SEO';
  if (preg_match('/aeo/', $id)) return 'AEO readiness';
  if (preg_match('/no-website/', $id)) return 'No website';
  return 'Design, content & maintenance';
}
function lf_cat(array $c): string { return $c['validation']['category'] ?? 'Unprocessed'; }
function lf_source_info(array $c): array {
  $src = $c['source'] ?? []; $id = (string) ($src['searchId'] ?? '');
  if (empty($src['by']) && $id) { $j = lf_job_get($id); if ($j) { $src['by'] = $j['params']['by'] ?? ($j['by'] ?? ''); $src['detail'] = $src['detail'] ?? (($j['params']['category'] ?? '') ?: ($j['params']['fileName'] ?? '')); } }
  return $src;
}

function lf_dashboard(): array {
  $all = lf_companies_all(); $s = lf_settings(); $hq = lf_hq_linked(); $today = gmdate('Y-m-d');
  $by = function (callable $fn) use ($all) { $m = []; foreach ($all as $c) { $k = $fn($c); $k = ($k === null || $k === '') ? 'Not set' : $k; $m[$k] = ($m[$k] ?? 0) + 1; } return $m; };
  $issueCats = []; $svc = [];
  foreach ($all as $c) {
    foreach ($c['issues'] ?? [] as $i) { $k = ($i['area'] ?? '') === 'gbp' ? 'Google profile · ' . ($i['group'] ?? 'Profile') : 'Website · ' . lf_website_group($i['id']); $issueCats[$k] = ($issueCats[$k] ?? 0) + 1; }
    if (lf_cat($c) === 'Qualified') foreach ($c['services'] ?? [] as $x) $svc[$x['name']] = ($svc[$x['name']] ?? 0) + 1;
  }
  $ids = array_flip(array_column($all, 'id'));
  $linked = array_filter($hq, fn($b, $lfId) => isset($ids[$lfId]), ARRAY_FILTER_USE_BOTH);
  $pipe = []; foreach (LF_HQ_STAGES as $k => $l) $pipe[$l] = count(array_filter($linked, fn($b) => ($b['status'] ?? 'lead') === $k));
  $leadStatus = [
    'available' => count(array_filter($all, fn($c) => !isset($hq[$c['id']]) || ($hq[$c['id']]['status'] ?? 'lead') === 'lead')),
    'picked' => count(array_filter($linked, fn($b) => ($b['status'] ?? '') === 'claimed')),
    'inProgress' => count(array_filter($linked, fn($b) => in_array($b['status'] ?? '', ['drafting', 'pitched', 'followup'], true))),
    'converted' => count(array_filter($linked, fn($b) => ($b['status'] ?? '') === 'won')),
    'soldOut' => count(array_filter($linked, fn($b) => ($b['status'] ?? '') === 'lost')),
  ];
  $count = fn(callable $f) => count(array_filter($all, $f));
  $demoRecords = (int) db()->query('SELECT COUNT(*) FROM lf_companies WHERE demo=1')->fetchColumn();
  $dups = count(lf_kv_get('duplicates', []));
  return [
    'demoMode' => !empty($s['demoMode']), 'demoRecords' => $demoRecords,
    'totals' => [
      'discovered' => count($all), 'active' => $count(fn($c) => ($c['activity']['status'] ?? '') === 'Verified'), 'withinWindow' => $count(fn($c) => ($c['age']['withinWindow'] ?? null) === true),
      'qualified' => $count(fn($c) => lf_cat($c) === 'Qualified'), 'unverified' => $count(fn($c) => lf_cat($c) === 'Unverified'), 'rejected' => $count(fn($c) => lf_cat($c) === 'Rejected'), 'noOpportunity' => $count(fn($c) => lf_cat($c) === 'No Opportunity'),
      'withoutWebsite' => $count(fn($c) => in_array($c['websiteStatus'] ?? '', ['Not found', 'Confirmed none'], true)),
      'weakGbp' => $count(fn($c) => count(array_filter($c['gbpAudit']['issues'] ?? [], fn($i) => $i['status'] === LF_CONFIRMED)) >= 2),
      'websiteIssues' => $count(fn($c) => (bool) array_filter($c['websiteAudit']['issues'] ?? [], fn($i) => $i['status'] === LF_CONFIRMED)),
      'highPriority' => $count(fn($c) => lf_cat($c) === 'Qualified' && ($c['score']['priority'] ?? '') === 'High'),
      'transferred' => count($linked),
      'followUpsDue' => count(array_filter($linked, fn($b) => !empty($b['nextDate']) && $b['nextDate'] <= $today && !in_array($b['status'] ?? '', ['won', 'lost'], true))),
      'converted' => count(array_filter($linked, fn($b) => ($b['status'] ?? '') === 'won')),
      'duplicatesSkipped' => $dups,
    ],
    'leadStatus' => $leadStatus,
    'charts' => ['validation' => $by('lf_cat'), 'industry' => $by(fn($c) => ($c['industryName'] ?? '') ?: (($c['industry'] ?? '') ?: 'Not set')),
      'location' => $by(fn($c) => implode(', ', array_filter([$c['area'] ?? '', $c['city'] ?? ''], 'strlen')) ?: (($c['country'] ?? '') ?: 'Not set')),
      'issues' => $issueCats, 'services' => $svc, 'pipeline' => $pipe, 'priority' => $by(fn($c) => lf_cat($c) === 'Qualified' ? ($c['score']['priority'] ?? null) : null)],
    'generatedAt' => lf_now_iso(),
  ];
}

function lf_summary(array $c, array $hq = []): array {
  $iss = $c['issues'] ?? []; $conf = array_values(array_filter($iss, fn($i) => $i['status'] === LF_CONFIRMED));
  $b = $hq[$c['id']] ?? null;
  $src = lf_source_info($c); $searcher = (string) ($src['by'] ?? '');
  return ['id' => $c['id'], 'name' => $c['name'], 'demo' => !empty($c['demo']), 'industry' => ($c['industryName'] ?? '') ?: ($c['industry'] ?? ''), 'city' => $c['city'] ?? '', 'area' => $c['area'] ?? '', 'country' => $c['country'] ?? '',
    'category' => lf_cat($c), 'reasons' => array_slice($c['validation']['reasons'] ?? [], 0, 3), 'score' => $c['score']['total'] ?? null, 'priority' => $c['score']['priority'] ?? '',
    'website' => $c['contact']['website'] ?? '', 'websiteStatus' => $c['websiteStatus'] ?? '', 'phone' => $c['contact']['phone'] ?? '', 'email' => $c['contact']['email'] ?? '',
    'activity' => $c['activity']['status'] ?? '', 'age' => $c['age']['status'] ?? '', 'ageWithin' => $c['age']['withinWindow'] ?? null,
    'confirmedIssues' => count($conf), 'potentialIssues' => count($iss) - count($conf), 'topIssues' => array_map(fn($i) => $i['title'], array_slice($conf, 0, 3)),
    'services' => array_map(fn($s) => $s['name'], array_slice($c['services'] ?? [], 0, 4)), 'rating' => $c['google']['rating'] ?? null, 'reviews' => $c['google']['userRatingCount'] ?? null,
    'pipeline' => $c['pipeline'] ?? [], 'hq' => $b ? ['id' => $b['id'], 'status' => $b['status'] ?? 'lead', 'ownerId' => $b['ownerId'] ?? null, 'claimedAt' => $b['claimedAt'] ?? null, 'createdAt' => $b['createdAt'] ?? null, 'updatedAt' => $b['updatedAt'] ?? null, 'nextDate' => $b['nextDate'] ?? ''] : null,
    'lastVerifiedAt' => $c['lastVerifiedAt'] ?? null, 'source' => $src['type'] ?? '', 'searcherId' => $searcher, 'searcherName' => $searcher ? userName($searcher) : '', 'searchId' => $src['searchId'] ?? '', 'searchLabel' => $src['detail'] ?? '',
    'deletedAt' => $c['deletedAt'] ?? null, 'deletedBy' => $c['deletedBy'] ?? null, 'deletedReason' => $c['deletedReason'] ?? ''];
}

const LF_DATASETS = ['qualified', 'unverified', 'rejected', 'no-opportunity', 'pipeline', 'all'];
function lf_in_dataset(array $c, string $ds): bool {
  return match ($ds) { 'qualified' => lf_cat($c) === 'Qualified', 'unverified' => lf_cat($c) === 'Unverified', 'rejected' => lf_cat($c) === 'Rejected', 'no-opportunity' => lf_cat($c) === 'No Opportunity',
    'pipeline' => !empty($c['pipeline']['inPipeline']) || !empty($c['pipeline']['hqId']), default => true };
}
function lf_export_table(string $ds = 'qualified'): array {
  if (!in_array($ds, LF_DATASETS, true)) $ds = 'qualified';
  $s = lf_settings(); $incG = !empty($s['includeGoogleContentInExports']); $hq = lf_hq_linked();
  $users = []; foreach (db()->query('SELECT id,name FROM users') as $u) $users[$u['id']] = $u['name'];
  $cv = function ($c, $f) use ($incG) { $src = (string) ($c['contactSources'][$f] ?? ''); return (!$incG && str_starts_with($src, 'Google') && empty($c['contactVerifiedAt'])) ? '' : (string) ($c['contact'][$f] ?? ''); };
  $header = ['Company', 'Validation', 'Reasons', 'Priority', 'Lead score', 'Industry', 'Country', 'City', 'Area', 'Phone', 'Email', 'Website', 'Website status',
    'Business status', 'Company age status', 'Earliest dated evidence', 'Website first archived', 'Detected issues', 'Recommended services', 'Pipeline stage',
    'Assigned to', 'Follow-up date', 'Last verified', 'Evidence sources', 'Lead source', 'Record ID'];
  if ($incG) array_splice($header, 17, 0, ['Google rating', 'Google review count', 'Google Maps link']);
  $rows = [];
  foreach (lf_companies_all() as $c) {
    if (!lf_in_dataset($c, $ds)) continue;
    $b = $hq[$c['id']] ?? null;
    $srcs = []; foreach ($c['age']['evidence'] ?? [] as $e) $srcs[] = $e['source'];
    if (!empty($c['google']['placeId'])) $srcs[] = 'Google Places API'; if (!empty($c['websiteAudit'])) $srcs[] = 'Website audit ' . substr((string) ($c['websiteAudit']['checkedAt'] ?? ''), 0, 10);
    $r = [$c['name'], lf_cat($c) === 'Unprocessed' ? '' : lf_cat($c), implode(' | ', $c['validation']['reasons'] ?? []), lf_cat($c) === 'Qualified' ? ($c['score']['priority'] ?? '') : '', $c['score']['total'] ?? '',
      ($c['industryName'] ?? '') ?: ($c['industry'] ?? ''), $c['country'] ?? '', $c['city'] ?? '', $c['area'] ?? '', $cv($c, 'phone'), $cv($c, 'email'), $c['contact']['website'] ?? '', $c['websiteStatus'] ?? '',
      $c['activity']['status'] ?? '', $c['age']['status'] ?? '', $c['age']['earliestDate'] ?? '', $c['age']['websiteAge']['firstSeen'] ?? '',
      implode(' | ', array_map(fn($i) => "{$i['title']} [{$i['status']}]", $c['issues'] ?? [])), implode(', ', array_map(fn($x) => $x['name'], $c['services'] ?? [])),
      $b ? (LF_HQ_STAGES[$b['status'] ?? 'lead'] ?? '') : '', $b && !empty($b['ownerId']) ? ($users[$b['ownerId']] ?? '') : '', $b['nextDate'] ?? '',
      str_replace('T', ' ', substr((string) ($c['lastVerifiedAt'] ?? ''), 0, 16)), implode('; ', array_values(array_unique(array_filter($srcs, 'strlen')))), ($c['source']['detail'] ?? '') ?: ($c['source']['type'] ?? ''), $c['id']];
    if ($incG) array_splice($r, 17, 0, [$c['google']['rating'] ?? '', $c['google']['userRatingCount'] ?? '', $c['google']['googleMapsUri'] ?? '']);
    $rows[] = $r;
  }
  return ['header' => $header, 'rows' => $rows, 'note' => $incG ? 'Includes Google Maps content. Check Google Maps Platform terms before sharing outside your team.' : 'Google Maps content (ratings, reviews and Google-only contact details) is excluded, as required by Google Maps Platform terms. Change this in Settings.'];
}
function lf_to_csv(array $t): string {
  $cell = fn($v) => '"' . str_replace('"', '""', (string) $v) . '"';
  return "\xEF\xBB\xBF" . implode("\r\n", array_map(fn($r) => implode(',', array_map($cell, $r)), array_merge([$t['header']], $t['rows'])));
}
