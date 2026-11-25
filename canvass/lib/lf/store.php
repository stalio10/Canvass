<?php
/* Lead Finder · storage in the shared SQLite database: companies, jobs, settings, usage counters, backups.
 * Replaces the v1.0 JSON file; backups keep the v1.0 JSON shape so old backups restore here and new ones restore there. */
declare(strict_types=1);

const LF_GOOGLE_RESTRICTED = ['rating', 'userRatingCount', 'reviews', 'photos', 'photoCount', 'photoAttributions', 'editorialSummary', 'regularOpeningHours', 'location', 'addressComponents', 'formattedAddress', 'types', 'primaryType', 'primaryTypeDisplayName', 'nationalPhoneNumber', 'internationalPhoneNumber', 'websiteUri', 'googleMapsUri', 'displayName', 'businessStatus'];

function lf_json($v): string { return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE); }
function lf_kv_get(string $k, $default = null) { $st = db()->prepare('SELECT v FROM lf_kv WHERE k=?'); $st->execute([$k]); $v = $st->fetchColumn(); if ($v === false) return $default; $d = json_decode($v, true); return $d ?? $default; }
function lf_kv_set(string $k, $v): void { db()->prepare('INSERT INTO lf_kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v')->execute([$k, lf_json($v)]); }
/** Atomic read-modify-write of one key. */
function lf_kv_update(string $k, callable $fn, $default = null) {
  $pdo = db(); $own = !$pdo->inTransaction(); if ($own) $pdo->exec('BEGIN IMMEDIATE');
  try { $v = $fn(lf_kv_get($k, $default)); lf_kv_set($k, $v); if ($own) $pdo->exec('COMMIT'); return $v; }
  catch (Throwable $e) { if ($own) $pdo->exec('ROLLBACK'); throw $e; }
}

/* ---------- settings ---------- */
function lf_settings(bool $fresh = false): array {
  static $cache = null; if ($cache !== null && !$fresh) return $cache;
  return $cache = lf_merge_defaults(lf_kv_get('settings', []));
}
function lf_settings_save(array $s): array { lf_kv_set('settings', $s); return lf_settings(true); }

/* ---------- companies ---------- */
function lf_index_cols(array $c): array {
  $nn = lf_norm_name($c['name'] ?? ''); $other = ($c['website']['domain'] ?? '') ?: lf_domain_of($c['contact']['website'] ?? '');
  $label = fn($d) => preg_replace('/[^a-z0-9]/', '', explode('.', (string) $d)[0]);
  return ['name' => $c['name'] ?? '', 'category' => $c['validation']['category'] ?? 'Unprocessed', 'score' => $c['score']['total'] ?? null, 'demo' => !empty($c['demo']) ? 1 : 0,
    'place_id' => $c['google']['placeId'] ?? null, 'domain' => ($c['website']['domain'] ?? '') ?: null, 'cdomain' => lf_domain_of($c['contact']['website'] ?? '') ?: null,
    'phone9' => lf_norm_phone($c['contact']['phone'] ?? '') ?: null, 'name_norm' => $nn ?: null, 'name_compact' => str_replace(' ', '', $nn) ?: null,
    'dom_label' => $other ? $label($other) : null, 'loc_norm' => lf_norm_place(($c['city'] ?? '') ?: ($c['area'] ?? '')) ?: null];
}
function lf_company_get(string $id): ?array { $st = db()->prepare('SELECT data FROM lf_companies WHERE id=?'); $st->execute([$id]); $d = $st->fetchColumn(); return $d ? json_decode($d, true) : null; }
function lf_company_put(array &$c): array {
  $c['updatedAt'] = lf_now_iso(); $ix = lf_index_cols($c);
  db()->prepare('INSERT INTO lf_companies(id,data,name,category,score,demo,place_id,domain,cdomain,phone9,name_norm,name_compact,dom_label,loc_norm,created_at,updated_at) VALUES(:id,:data,:name,:category,:score,:demo,:place_id,:domain,:cdomain,:phone9,:name_norm,:name_compact,:dom_label,:loc_norm,:created_at,:updated_at)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data,name=excluded.name,category=excluded.category,score=excluded.score,demo=excluded.demo,place_id=excluded.place_id,domain=excluded.domain,cdomain=excluded.cdomain,phone9=excluded.phone9,name_norm=excluded.name_norm,name_compact=excluded.name_compact,dom_label=excluded.dom_label,loc_norm=excluded.loc_norm,updated_at=excluded.updated_at')
    ->execute(['id' => $c['id'], 'data' => lf_json($c), 'created_at' => $c['createdAt'] ?? lf_now_iso(), 'updated_at' => $c['updatedAt']] + $ix);
  return $c;
}
function lf_company_remove(string $id): bool { $st = db()->prepare('DELETE FROM lf_companies WHERE id=?'); $st->execute([$id]); return $st->rowCount() > 0; }
function lf_companies_all(?bool $includeDemo = null): array {
  $demo = $includeDemo ?? !empty(lf_settings()['demoMode']);
  $out = []; foreach (db()->query('SELECT data FROM lf_companies' . ($demo ? '' : ' WHERE demo=0')) as $r) $out[] = json_decode($r['data'], true);
  return $out;
}

/** Duplicate detection: Place ID → website domain → phone → normalised name + city/area → name matches website domain. */
function lf_find_duplicate(array $cand, ?string $excludeId = null): ?array {
  $placeId = ($cand['google']['placeId'] ?? '') ?: ($cand['placeId'] ?? '');
  $domain = ($cand['website']['domain'] ?? '') ?: lf_domain_of($cand['contact']['website'] ?? '');
  $phone = lf_norm_phone($cand['contact']['phone'] ?? ''); $name = lf_norm_name($cand['name'] ?? '');
  $loc = lf_norm_place(($cand['city'] ?? '') ?: ($cand['area'] ?? '')); $compact = str_replace(' ', '', $name);
  $label = fn($d) => preg_replace('/[^a-z0-9]/', '', explode('.', (string) $d)[0]);
  $where = []; $args = [];
  if ($placeId) { $where[] = 'place_id=?'; $args[] = $placeId; }
  if ($domain) { $where[] = 'domain=?'; $args[] = $domain; $where[] = 'name_compact=?'; $args[] = $label($domain); }
  if ($phone) { $where[] = 'phone9=?'; $args[] = $phone; }
  if ($name) { $where[] = 'name_norm=?'; $args[] = $name; }
  if (strlen($compact) >= 5) { $where[] = 'dom_label=?'; $args[] = $compact; }
  if (!$where) return null;
  $st = db()->prepare('SELECT data FROM lf_companies WHERE demo=? AND (' . implode(' OR ', $where) . ') ORDER BY created_at'); $st->execute(array_merge([!empty($cand['demo']) ? 1 : 0], $args));
  foreach ($st as $r) {
    $c = json_decode($r['data'], true);
    if ($c['id'] === $excludeId) continue;
    if ($placeId && ($c['google']['placeId'] ?? null) === $placeId) return ['match' => $c, 'by' => 'Google Place ID'];
    if ($domain && !empty($c['website']['domain']) && $c['website']['domain'] === $domain) return ['match' => $c, 'by' => 'website domain'];
    if ($phone && lf_norm_phone($c['contact']['phone'] ?? '') === $phone) return ['match' => $c, 'by' => 'phone number'];
    $cl = lf_norm_place(($c['city'] ?? '') ?: ($c['area'] ?? ''));
    if ($name && $name === lf_norm_name($c['name'] ?? '') && (!$loc || !$cl || $cl === $loc)) return ['match' => $c, 'by' => 'business name and location'];
    $other = ($c['website']['domain'] ?? '') ?: lf_domain_of($c['contact']['website'] ?? '');
    if (strlen($compact) >= 5 && (($other && $label($other) === $compact) || ($domain && $label($domain) === str_replace(' ', '', lf_norm_name($c['name'] ?? ''))))) return ['match' => $c, 'by' => 'business name matches website domain'];
  }
  return null;
}
function lf_log_duplicate(array $e): void { lf_kv_update('duplicates', fn($l) => array_slice(array_merge([['at' => lf_now_iso()] + $e], $l ?: []), 0, 2000), []); }
function lf_add_search(array $s): void { lf_kv_update('searches', fn($l) => array_slice(array_merge([$s], $l ?: []), 0, 500), []); }

/* ---------- free-tier protection and usage ---------- */
function lf_pacific(?float $t, bool $withDay): string { $d = new DateTime('@' . (int) ($t ?? time())); $d->setTimezone(new DateTimeZone('America/Los_Angeles')); return $d->format($withDay ? 'Y-m-d' : 'Y-m'); }
function lf_budget_status(?float $now = null): array {
  $b = lf_settings()['budget']; $month = lf_pacific($now, false); $day = lf_pacific($now, true); $bill = lf_kv_get('billing', []);
  $used = (int) ($bill['months'][$month]['places'] ?? 0); $dayUsed = (int) ($bill['days'][$day]['places'] ?? 0);
  return ['enabled' => (bool) $b['enabled'], 'month' => $month, 'used' => $used, 'limit' => (int) $b['placesMonthlyLimit'], 'remaining' => $b['enabled'] ? max(0, $b['placesMonthlyLimit'] - $used) : null,
    'dayUsed' => $dayUsed, 'dayLimit' => (int) $b['placesDailyLimit'], 'dayRemaining' => $b['enabled'] ? max(0, $b['placesDailyLimit'] - $dayUsed) : null];
}
/** Refuse a Google Places request once the monthly or daily limit is reached — before anything is sent. */
function lf_assert_within_budget(string $api): void {
  if ($api !== 'places') return;
  $s = lf_budget_status(); if (!$s['enabled']) return;
  if ($s['remaining'] <= 0) throw new ApiError("Monthly Google Places limit reached ({$s['used']} of {$s['limit']} requests in {$s['month']}). Canvass stopped before making a billable request. It resets next month, or raise the limit in Settings.", ['api' => $api, 'code' => 'BUDGET']);
  if ($s['dayRemaining'] <= 0) throw new ApiError("Daily Google Places limit reached ({$s['dayUsed']} of {$s['dayLimit']} today). Canvass stopped before making a billable request. Try again tomorrow, or raise the limit in Settings.", ['api' => $api, 'code' => 'BUDGET']);
}
function lf_track_usage(string $api, bool $ok): void {
  if ($api === 'net') return;
  if ($api === 'places') lf_kv_update('billing', function ($b) {           // every attempt counts (including failures) so the cap errs on the safe side
    $b = is_array($b) ? $b : []; $m = lf_pacific(null, false); $d = lf_pacific(null, true);
    $b['months'][$m]['places'] = ($b['months'][$m]['places'] ?? 0) + 1; $b['days'][$d]['places'] = ($b['days'][$d]['places'] ?? 0) + 1;
    ksort($b['days']); $b['days'] = array_slice($b['days'], -60, null, true); return $b;
  }, []);
  lf_kv_update('usage', function ($u) use ($api, $ok) {
    $u = is_array($u) ? $u : []; $day = gmdate('Y-m-d');
    $u[$day][$api] = $u[$day][$api] ?? ['ok' => 0, 'failed' => 0]; $u[$day][$api][$ok ? 'ok' : 'failed']++;
    krsort($u); return array_slice($u, 0, 400, true);
  }, []);
}
function lf_usage_summary(int $days = 30): array {
  $cost = lf_settings()['costPer1000']; $u = lf_kv_get('usage', []); krsort($u); $out = [];
  foreach (array_slice($u, 0, $days, true) as $day => $apis) {
    $est = 0; foreach ($apis as $api => $v) $est += (($v['ok'] + $v['failed']) / 1000) * ($cost[$api] ?? 0);
    $out[] = ['day' => $day, 'apis' => $apis, 'estimatedCostUsd' => $est];
  }
  return $out;
}
function lf_install_http_hooks(): void {
  LfHttp::$budgetGuard = 'lf_assert_within_budget';
  LfHttp::$usageSink = 'lf_track_usage';
}

/** Google Maps Platform terms: Places content may be cached for at most 30 days; Place IDs may be kept. */
function lf_purge_expired_google(): int {
  $days = lf_settings()['googleRetentionDays']; $n = 0;
  foreach (db()->query('SELECT id FROM lf_companies WHERE place_id IS NOT NULL')->fetchAll(PDO::FETCH_COLUMN) as $id) {
    $c = lf_company_get($id); $g = $c['google'] ?? null;
    if (!$g || empty($g['fetchedAt']) || !empty($g['expired'])) continue;
    if ((microtime(true) - lf_ts($g['fetchedAt'])) / 86400 <= $days) continue;
    foreach (LF_GOOGLE_RESTRICTED as $f) unset($c['google'][$f]);
    $c['google']['expired'] = true; $c['google']['expiredAt'] = lf_now_iso();
    $removed = [];
    if (empty($c['contactVerifiedAt'])) foreach ($c['contactSources'] ?? [] as $field => $src) {     // Google-only contact details go too, unless the team confirmed them
      if (str_starts_with((string) $src, 'Google') && isset($c['contact'][$field])) { $removed[$field] = $c['contact'][$field]; unset($c['contact'][$field], $c['contactSources'][$field]); }
    }
    if (!empty($c['reviewAnalysis'])) $c['reviewAnalysis'] = ['status' => 'Not Available', 'note' => 'Google review content removed after the retention period. Refresh to re-analyse.'];
    if ($removed && !empty($c['pipeline']['hqId'])) lf_hq_scrub_google($c['pipeline']['hqId'], $removed);
    lf_company_put($c); $n++;
  }
  return $n;
}

/* ---------- backups (v1.0 JSON shape) ---------- */
function lf_state_export(bool $withKeys = false): array {
  $s = lf_settings(); if (!$withKeys) { $s['googlePlacesKey'] = ''; $s['pageSpeedKey'] = ''; }    // never put secrets in a downloadable file
  $companies = []; foreach (db()->query('SELECT id,data FROM lf_companies') as $r) $companies[$r['id']] = json_decode($r['data'], true);
  $jobs = []; foreach (db()->query('SELECT data FROM lf_jobs ORDER BY created_at DESC LIMIT 300') as $r) { $j = json_decode($r['data'], true); unset($j['work']); $jobs[] = $j; }
  return ['meta' => ['schema' => 1, 'app' => 'Canvass ' . APP_VERSION, 'exportedAt' => lf_now_iso()], 'settings' => $s, 'companies' => (object) $companies, 'jobs' => $jobs,
    'searches' => lf_kv_get('searches', []), 'duplicates' => lf_kv_get('duplicates', []), 'usage' => (object) lf_kv_get('usage', []), 'billing' => lf_kv_get('billing', (object) [])];
}
function lf_backup_dir(): string { $d = dataDir() . '/backups'; if (!is_dir($d)) @mkdir($d, 0700, true); return $d; }
function lf_backup(string $kind = 'manual'): string {
  $name = 'canvass-backup-' . gmdate('Y-m-d\TH-i-s') . '-' . substr(bin2hex(random_bytes(2)), 0, 3) . '-' . $kind . '.json';
  file_put_contents(lf_backup_dir() . '/' . $name, lf_json(lf_state_export()));
  $autos = array_values(array_filter(lf_list_backups(), fn($b) => str_ends_with($b['name'], '-auto.json')));
  foreach (array_slice($autos, 14) as $old) @unlink(lf_backup_dir() . '/' . $old['name']);
  return $name;
}
function lf_list_backups(): array {
  $out = [];
  foreach (glob(lf_backup_dir() . '/canvass-backup-*.json') ?: [] as $f) $out[] = ['name' => basename($f), 'size' => filesize($f), 'createdAt' => gmdate('c', filemtime($f))];
  usort($out, fn($a, $b) => strcmp($b['name'], $a['name']));
  return $out;
}
function lf_read_backup(string $name): string {
  if (!preg_match('/^canvass-backup-[\w-]+\.json$/', $name)) throw new HttpFail('Invalid backup name');
  $f = lf_backup_dir() . '/' . $name; if (!is_file($f)) throw new HttpFail('Backup not found', 404);
  return (string) file_get_contents($f);
}
/** Replace Lead Finder data with a backup (from this app or from the v1.0 Windows app). Keeps this server's API keys. */
function lf_restore($json, bool $keepKeys = true): int {
  $in = is_string($json) ? json_decode($json, true) : $json;
  if (!is_array($in) || !isset($in['companies']) || !is_array($in['companies'])) throw new HttpFail('Not a Canvass database file');
  lf_backup('pre-restore');
  $cur = lf_settings(); $s = lf_merge_defaults($in['settings'] ?? []);
  if ($keepKeys) { $s['googlePlacesKey'] = $cur['googlePlacesKey']; $s['pageSpeedKey'] = $cur['pageSpeedKey']; }
  $pdo = db(); $pdo->exec('BEGIN IMMEDIATE');
  try {
    $pdo->exec('DELETE FROM lf_companies'); $pdo->exec("DELETE FROM lf_jobs WHERE status NOT IN ('queued','running')");
    $n = 0; foreach ($in['companies'] as $c) { if (!is_array($c) || empty($c['id'])) continue; $c['pipeline'] = ($c['pipeline'] ?? []) + ['inPipeline' => false, 'stage' => '', 'notes' => [], 'history' => [], 'contactLog' => [], 'doNotContact' => false]; lf_company_put($c); $n++; }
    lf_kv_set('settings', $s);
    foreach (['searches', 'duplicates'] as $k) lf_kv_set($k, is_array($in[$k] ?? null) ? $in[$k] : []);
    if (is_array($in['usage'] ?? null)) lf_kv_set('usage', $in['usage']);
    if (is_array($in['billing'] ?? null)) { $b = lf_kv_get('billing', []); foreach (['months', 'days'] as $k) foreach ($in['billing'][$k] ?? [] as $p => $v) $b[$k][$p]['places'] = max($b[$k][$p]['places'] ?? 0, $v['places'] ?? 0); lf_kv_set('billing', $b); }
    foreach ($in['jobs'] ?? [] as $j) if (is_array($j) && !empty($j['id']) && !in_array($j['status'] ?? '', ['queued', 'running'], true))
      $pdo->prepare('INSERT OR REPLACE INTO lf_jobs(id,status,data,created_at,updated_at) VALUES(?,?,?,?,?)')->execute([$j['id'], $j['status'], lf_json($j), $j['createdAt'] ?? lf_now_iso(), lf_now_iso()]);
    $pdo->exec('COMMIT');
  } catch (Throwable $e) { $pdo->exec('ROLLBACK'); throw $e; }
  lf_settings(true);
  return $n;
}
