<?php
/* Tiny test harness for Canvass (no dependencies). Run all tests:  php tests/run.php */
declare(strict_types=1);
$GLOBALS['T'] = ['pass' => 0, 'fail' => 0, 'failures' => [], 'file' => ''];
function test(string $name, callable $fn): void {
  try { $fn(); $GLOBALS['T']['pass']++; echo "  \u{2713} $name\n"; }
  catch (Throwable $e) { $GLOBALS['T']['fail']++; $GLOBALS['T']['failures'][] = $GLOBALS['T']['file'] . ': ' . $name . ' — ' . $e->getMessage(); echo "  \u{2717} $name\n      " . $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ")\n"; }
}
function ok_($cond, string $msg = 'expected true'): void { if (!$cond) throw new RuntimeException($msg); }
function eq($a, $b, string $msg = ''): void { if ($a !== $b) throw new RuntimeException(($msg ? "$msg: " : '') . 'expected ' . json_encode($b, JSON_UNESCAPED_UNICODE) . ', got ' . json_encode($a, JSON_UNESCAPED_UNICODE)); }
function match_(string $re, $s, string $msg = ''): void { if (!preg_match($re, (string) $s)) throw new RuntimeException(($msg ? "$msg: " : '') . "\"" . mb_substr((string) $s, 0, 300) . "\" does not match $re"); }
function throws(callable $fn, string $re = '/./'): Throwable { try { $fn(); } catch (Throwable $e) { match_($re, $e->getMessage()); return $e; } throw new RuntimeException("expected an error matching $re"); }
function deep_eq($a, $b, string $msg = ''): void { if (json_encode($a) !== json_encode($b)) throw new RuntimeException(($msg ? "$msg: " : '') . 'expected ' . json_encode($b) . ', got ' . json_encode($a)); }
function iso_ago(float $days): string { return lf_now_iso(microtime(true) - $days * 86400); }

/* engine tests share one temporary database; reset() empties it between tests */
function boot_engine(): void {
  if (!getenv('CANVASS_DATA_DIR')) putenv('CANVASS_DATA_DIR=' . sys_get_temp_dir() . '/canvass-test-' . bin2hex(random_bytes(4)));
  require_once __DIR__ . '/../lib/lf/bootstrap.php';
  LfHttp::$sleep = false;
}
function reset_db(): void {
  foreach (['lf_companies', 'lf_jobs', 'lf_kv', 'businesses', 'tombstones', 'acc_entries', 'acc_rec'] as $t) db()->exec("DELETE FROM $t");
  lf_settings(true); lf_install_http_hooks(); LfHttp::$transport = null;
}
function settings_for_tests(array $over = []): array {
  $s = lf_settings(); $s['googlePlacesKey'] = 'TEST_KEY'; $s['runPageSpeed'] = false; $s['brokenLinkSample'] = 0;
  return lf_settings_save(array_replace_recursive($s, $over));
}
function resp(int $status, $body, array $headers = []): array { return ['status' => $status, 'body' => is_string($body) ? $body : json_encode($body), 'headers' => $headers + ['content-type' => is_string($body) ? 'text/html' : 'application/json']]; }
/** Run queued jobs to completion with the background worker. */
function run_jobs(int $max = 400): void { for ($i = 0; $i < $max; $i++) { $r = lf_tick(5, 'test'); if (empty($r['pending'])) return; } throw new RuntimeException('jobs did not finish'); }
