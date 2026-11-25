<?php
/* Lead Finder · API actions (api.php?a=lf_…). Every action needs a signed-in Canvass user. Settings, restore and deletes need the admin. */
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';

function lf_need(bool $cond, string $msg, int $code = 400): void { if (!$cond) throw new HttpFail($msg, $code); }
function lf_admin(array $u): void { lf_need(isAdmin($u), 'Only the admin can do that.', 403); }
function lf_company_or_404(string $id): array { $c = lf_company_get($id); lf_need((bool) $c, 'Company not found.', 404); return $c; }
function lf_worker_status(): array {
  $w = lf_kv_get('worker', null); $age = $w ? time() - (int) $w['at'] : null;
  return ['lastAt' => $w['at'] ?? null, 'mode' => $w['mode'] ?? null, 'background' => $w && in_array($w['mode'], ['cron', 'loop'], true) && $age < 180];
}
function lf_health(): array {
  $s = lf_settings();
  return ['ok' => true, 'version' => APP_VERSION, 'time' => lf_now_iso(), 'placesKey' => (bool) lf_effective_key($s, 'googlePlacesKey'), 'pageSpeedKey' => (bool) lf_effective_key($s, 'pageSpeedKey'),
    'demoMode' => !empty($s['demoMode']), 'budget' => lf_budget_status(), 'worker' => lf_worker_status(),
    'running' => (int) db()->query("SELECT COUNT(*) FROM lf_jobs WHERE status IN ('queued','running')")->fetchColumn()];
}
/** Raw file download (CSV, backup). */
function lf_send_file(string $body, string $type, string $name): void {
  header('Content-Type: ' . $type); header('Content-Disposition: attachment; filename="' . $name . '"'); header('Content-Length: ' . strlen($body));
  echo $body; exit;
}

function lf_dispatch(string $a, array $u, array $b): array {
  $by = $u['id'];
  switch ($a) {
    case 'lf_health': return lf_health();
    case 'lf_settings': return lf_public_settings(lf_settings());
    case 'lf_settings_save': lf_admin($u); return lf_public_settings(lf_settings_save(lf_apply_settings_patch(lf_settings(), $b)));
    case 'lf_dashboard': return lf_dashboard();
    case 'lf_companies': {
      $q = $_GET; $hq = lf_hq_linked();
      $list = lf_companies_all();
      $cat = (string) ($q['category'] ?? ''); if ($cat !== '' && $cat !== 'all') $list = array_filter($list, fn($c) => lf_cat($c) === $cat);
      if (($q['pipeline'] ?? '') === '1') $list = array_filter($list, fn($c) => isset($hq[$c['id']]));
      if (!empty($q['industry'])) $list = array_filter($list, fn($c) => ($c['industryId'] ?? '') === $q['industry'] || ($c['industryName'] ?? '') === $q['industry']);
      if (!empty($q['priority'])) $list = array_filter($list, fn($c) => ($c['score']['priority'] ?? '') === $q['priority']);
      if (!empty($q['city'])) $list = array_filter($list, fn($c) => strtolower($c['city'] ?? '') === strtolower($q['city']));
      if (!empty($q['job'])) $list = array_filter($list, fn($c) => ($c['source']['searchId'] ?? '') === $q['job']);
      $text = mb_strtolower(trim((string) ($q['q'] ?? '')));
      if ($text !== '') $list = array_filter($list, fn($c) => str_contains(mb_strtolower(implode(' ', [$c['name'], $c['contact']['website'] ?? '', $c['city'] ?? '', $c['area'] ?? '', $c['industryName'] ?? '', $c['contact']['phone'] ?? '', $c['contact']['email'] ?? ''])), $text));
      $list = array_values($list); $sort = $q['sort'] ?? 'score';
      usort($list, $sort === 'recent' ? fn($x, $y) => strcmp((string) ($y['updatedAt'] ?? ''), (string) ($x['updatedAt'] ?? '')) : ($sort === 'name' ? fn($x, $y) => strcasecmp($x['name'], $y['name']) : fn($x, $y) => ($y['score']['total'] ?? -1) <=> ($x['score']['total'] ?? -1)));
      $page = max(0, (int) ($q['page'] ?? 0)); $size = min(200, max(1, (int) ($q['size'] ?? 50) ?: 50));
      return ['total' => count($list), 'page' => $page, 'size' => $size, 'items' => array_map(fn($c) => lf_summary($c, $hq), array_slice($list, $page * $size, $size))];
    }
    case 'lf_company': { $c = lf_company_or_404((string) ($_GET['id'] ?? '')); $hq = lf_hq_linked(); $c['hq'] = lf_summary($c, $hq)['hq']; return $c; }
    case 'lf_company_patch': {
      $c = lf_company_or_404((string) ($b['id'] ?? '')); $p = &$c['pipeline'];
      if (array_key_exists('note', $b) && trim((string) $b['note']) !== '') { $p['notes'][] = ['at' => lf_now_iso(), 'text' => mb_substr((string) $b['note'], 0, 2000), 'by' => $by]; $p['history'][] = ['at' => lf_now_iso(), 'event' => 'Note added']; }
      if (isset($b['doNotContact']) && is_bool($b['doNotContact'])) { $p['doNotContact'] = $b['doNotContact']; $p['history'][] = ['at' => lf_now_iso(), 'event' => $b['doNotContact'] ? 'Marked do-not-contact' : 'Do-not-contact removed']; }
      if (($b['contactVerified'] ?? null) === true) { $c['contactVerifiedAt'] = lf_now_iso(); $p['history'][] = ['at' => lf_now_iso(), 'event' => 'Contact details confirmed independently by the team']; }
      unset($p); lf_company_put($c); return $c;
    }
    case 'lf_company_delete': {
      $id = (string) ($b['id'] ?? ''); $c = lf_company_or_404($id);
      lf_need(isAdmin($u) || ($c['source']['by'] ?? '') === $by, 'Only the admin can delete Lead Finder records.', 403);
      return ['deleted' => lf_company_remove($id)];
    }
    case 'lf_evidence': {
      $c = lf_company_or_404((string) ($b['id'] ?? ''));
      $source = trim((string) ($b['source'] ?? '')); lf_need(mb_strlen($source) >= 3, 'Add the evidence source (e.g. "DED trade licence 123456" or a link).');
      $type = (string) ($b['type'] ?? ''); $url = lf_normalize_url($b['url'] ?? '');
      if ($type === 'establishment') { $t = lf_ts((string) ($b['date'] ?? '')); lf_need($t !== null && $t <= time(), 'Enter a valid establishment date.'); $c['manual']['establishment'] = ['date' => gmdate('Y-m-d', (int) $t), 'source' => $source, 'url' => $url, 'enteredAt' => lf_now_iso(), 'by' => $u['name']]; }
      elseif ($type === 'activity') $c['manual']['activity'][] = ['label' => mb_substr((string) (($b['label'] ?? '') ?: 'Recent activity verified by team'), 0, 200), 'source' => $source, 'url' => $url, 'enteredAt' => lf_now_iso(), 'recent' => true, 'by' => $u['name']];
      elseif ($type === 'no-website') { $c['manual']['noWebsiteConfirmed'] = true; $c['manual']['noWebsiteNote'] = $source; $c['manual']['noWebsiteAt'] = lf_now_iso(); }
      elseif ($type === 'identity') $c['manualIdentity'] = ['source' => $source, 'url' => $url, 'at' => lf_now_iso()];
      elseif ($type === 'invalid') $c['invalid'] = $source;
      else throw new HttpFail('Unknown evidence type.');
      lf_process_company($c, ['settings' => lf_settings(), 'offline' => true]); lf_save($c, $by); return $c;
    }
    case 'lf_contact_log': {
      $c = lf_company_or_404((string) ($b['id'] ?? '')); $p = &$c['pipeline'];
      $ch = (string) ($b['channel'] ?? ''); lf_need(in_array($ch, ['email', 'whatsapp', 'call', 'proposal', 'auditOffer'], true), 'Unknown channel.');
      lf_need(empty($p['doNotContact']), 'This company asked not to be contacted.', 409);
      $last = null; foreach (array_reverse($p['contactLog'] ?? []) as $l) if ($l['channel'] === $ch) { $last = $l; break; }
      $days = lf_settings()['contactCooldownDays'];
      if ($last && empty($b['force']) && (time() - lf_ts($last['at'])) / 86400 < $days) throw new HttpFail("Already contacted by $ch on " . substr($last['at'], 0, 10) . ". Wait $days days or confirm to log again.", 409);
      $p['contactLog'][] = ['at' => lf_now_iso(), 'channel' => $ch, 'note' => mb_substr((string) ($b['note'] ?? ''), 0, 500), 'by' => $by];
      $p['history'][] = ['at' => lf_now_iso(), 'event' => "Contacted by $ch (sent manually by {$u['name']})"];
      unset($p);
      $hqId = $c['pipeline']['hqId'] ?? null; $biz = $hqId ? getBiz($hqId) : null;
      if ($biz) {                                                     // the pipeline card moves to Pitched and shows the contact in its activity
        $t = nowMs(); $label = ['email' => 'email', 'whatsapp' => 'WhatsApp message', 'call' => 'call', 'proposal' => 'proposal', 'auditOffer' => 'audit offer'][$ch];
        $biz['activities'] = array_slice(array_merge($biz['activities'] ?? [], [['id' => gid(), 'type' => $ch === 'call' ? 'call' : 'note', 'who' => $by, 'when' => $t, 'note' => "Sent the $label from Lead Finder", 'by' => $by, 'at' => $t]]), -300);
        if (in_array($biz['status'] ?? 'lead', ['lead', 'claimed', 'drafting'], true)) { $biz['status'] = 'pitched'; $biz['pitchedAt'] = $biz['pitchedAt'] ?? $t; if (empty($biz['ownerId'])) { $biz['ownerId'] = $by; $biz['claimedAt'] = $t; } }
        $biz['log'] = array_slice(array_merge($biz['log'] ?? [], [['by' => $by, 'at' => $t, 't' => "logged the $label from Lead Finder"]]), -40);
        $biz['updatedAt'] = $t; putBiz($hqId, $biz); bump();
      }
      lf_company_put($c); return $c;
    }
    case 'lf_to_pipeline': {
      $c = lf_company_or_404((string) ($b['id'] ?? ''));
      lf_need(lf_cat($c) === 'Qualified' || !empty($b['force']), 'Only qualified leads go to the pipeline automatically. Confirm to add it anyway.', 409);
      lf_need(empty($c['demo']), 'Demo records can’t be added to the pipeline.');
      if (empty($c['pipeline']['inPipeline'])) { $c['pipeline']['inPipeline'] = true; $c['pipeline']['stage'] = 'New'; $c['pipeline']['transferredAt'] = lf_now_iso(); $c['pipeline']['history'][] = ['at' => lf_now_iso(), 'event' => 'Added to the pipeline by ' . $u['name']]; }
      $id = lf_hq_transfer($c, $by); return ['hqId' => $id, 'rev' => rev()];
    }
    case 'lf_refresh': {
      $ids = array_values(array_filter(array_map('strval', (array) ($b['ids'] ?? [])), fn($id) => (bool) lf_company_get($id)));
      lf_need((bool) $ids, 'No companies selected.'); return lf_job_public(lf_start_refresh(array_slice($ids, 0, 500), $by));
    }
    case 'lf_discover': return lf_job_public(lf_start_discovery($b, $by));
    case 'lf_bulk': return lf_job_public(lf_start_bulk($b, $by));
    case 'lf_bulk_legacy': return lf_job_public(lf_start_bulk(['rows' => lf_legacy_rows(), 'fileName' => 'Legacy Canvass list', 'legacy' => true], $by));
    case 'lf_jobs': return ['jobs' => lf_jobs_list(50), 'worker' => lf_worker_status()];
    case 'lf_job': { $j = lf_job_get((string) ($_GET['id'] ?? '')); lf_need((bool) $j, 'Job not found.', 404); return lf_job_public($j); }
    case 'lf_job_cancel': return ['cancelled' => lf_job_cancel((string) ($b['id'] ?? ''))];
    case 'lf_tick': {                                                 // the open browser keeps jobs moving when no background worker is running
      if (lf_worker_status()['background']) return ['skipped' => 'background worker active'] + ['pending' => (int) db()->query("SELECT COUNT(*) FROM lf_jobs WHERE status IN ('queued','running')")->fetchColumn()];
      if (function_exists('session_write_close')) @session_write_close();
      return lf_tick(8, 'browser');
    }
    case 'lf_history': return ['searches' => array_slice(lf_kv_get('searches', []), 0, 200), 'duplicates' => array_slice(lf_kv_get('duplicates', []), 0, 300)];
    case 'lf_usage': return ['budget' => lf_budget_status(), 'days' => lf_usage_summary(60), 'costPer1000' => lf_settings()['costPer1000'], 'note' => 'Estimated from request counts and the prices in Settings. Check your Google Cloud billing for actual charges.'];
    case 'lf_export': {
      $ds = (string) ($_GET['dataset'] ?? 'qualified'); $t = lf_export_table($ds);
      if (($_GET['format'] ?? '') === 'csv') lf_send_file(lf_to_csv($t), 'text/csv; charset=utf-8', 'canvass-' . preg_replace('/[^a-z-]/', '', $ds) . '-' . gmdate('Y-m-d') . '.csv');
      return $t;
    }
    case 'lf_backup_download': lf_send_file(json_encode(lf_state_export(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'application/json', 'canvass-backup-' . gmdate('Y-m-d') . '.json');
    case 'lf_backup_save': return ['created' => lf_backup('manual')];
    case 'lf_backups': return ['backups' => lf_list_backups()];
    case 'lf_backup_restore': lf_admin($u); $n = lf_restore(lf_read_backup((string) ($b['name'] ?? ''))); lf_sync_pipeline($by); return ['restored' => $n];
    case 'lf_restore': lf_admin($u); lf_need(isset($b['companies']), 'This is not a Canvass backup file.'); $n = lf_restore($b); $moved = lf_sync_pipeline($by); return ['restored' => $n, 'addedToPipeline' => $moved];
    case 'lf_demo_load': lf_admin($u); $s = lf_settings(); $s['demoMode'] = true; lf_settings_save($s); return ['loaded' => lf_load_demo()];
    case 'lf_demo_clear': lf_admin($u); $n = lf_clear_demo(); $s = lf_settings(); $s['demoMode'] = false; lf_settings_save($s); return ['removed' => $n];
    case 'lf_schedules': return ['schedules' => lf_settings()['schedules']];
    case 'lf_schedule_save': {
      $p = (array) ($b['params'] ?? []); lf_need(!empty($p['city']) && !empty($p['industryId']), 'Choose a city and industry for the schedule.');
      $s = lf_settings();
      $s['schedules'][] = ['id' => lf_new_id('sch'), 'name' => mb_substr((string) (($b['name'] ?? '') ?: (($p['category'] ?? '') ?: $p['industryId']) . ' in ' . $p['city']), 0, 80), 'params' => array_intersect_key($p, array_flip(['country', 'city', 'area', 'industryId', 'category', 'count'])),
        'everyHours' => max(24, (int) ($b['everyHours'] ?? 168) ?: 168), 'enabled' => true, 'createdAt' => lf_now_iso(), 'by' => $by];
      lf_settings_save($s); return ['ok' => true];
    }
    case 'lf_schedule_delete': { $s = lf_settings(); $s['schedules'] = array_values(array_filter($s['schedules'], fn($x) => $x['id'] !== ($b['id'] ?? ''))); lf_settings_save($s); return ['ok' => true]; }
  }
  throw new HttpFail('Unknown action', 404);
}

/** After a restore from v1.0: companies that were in the old sales pipeline become Canvass businesses (once). */
function lf_sync_pipeline(?string $by): int {
  $n = 0;
  foreach (db()->query('SELECT id FROM lf_companies WHERE demo=0')->fetchAll(PDO::FETCH_COLUMN) as $id) {
    $c = lf_company_get($id);
    if (!empty($c['pipeline']['inPipeline']) && (empty($c['pipeline']['hqId']) || !getBiz($c['pipeline']['hqId']))) { unset($c['pipeline']['hqId']); lf_hq_transfer($c, $by); $n++; }
  }
  return $n;
}
