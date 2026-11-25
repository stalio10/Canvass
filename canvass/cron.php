<?php
/* Canvass · background worker for Lead Finder searches, uploads, scheduled searches, daily backups and the 30-day Google purge.
 *  Hostinger:  hPanel → Advanced → Cron Jobs → every minute:   /usr/bin/php /home/<user>/domains/<site>/public_html/cron.php
 *  Your PC:    started for you by start-canvass (runs:  php cron.php --loop)
 *  It can also be called over the web as cron.php?key=<CANVASS_CRON_KEY> if that environment variable is set. */
declare(strict_types=1);
require_once __DIR__ . '/lib/lf/bootstrap.php';

$cli = PHP_SAPI === 'cli';
if (!$cli) {
  $key = (string) (getenv('CANVASS_CRON_KEY') ?: '');
  if ($key === '' || !hash_equals($key, (string) ($_GET['key'] ?? ''))) { http_response_code(403); header('Content-Type: text/plain'); echo "Forbidden\n"; exit; }
  header('Content-Type: text/plain');
}
$loop = $cli && in_array('--loop', $argv ?? [], true);
$say = function (string $m) use ($cli) { echo gmdate('H:i:s') . ' ' . $m . "\n"; if (!$cli) @flush(); };

if ($loop) {
  $say('Canvass background worker started. Leave this window open while you use Lead Finder.');
  $watch = null; foreach ($argv as $a) if (str_starts_with($a, '--watch=')) $watch = substr($a, 8);   // host:port of the local Canvass server
  $r = []; $missed = 0;
  for (;;) {
    if ($watch) { [$h, $pt] = explode(':', $watch) + [1 => '80']; $fp = @fsockopen($h, (int) $pt, $en, $es, 2); if ($fp) { fclose($fp); $missed = 0; } elseif (++$missed >= 5) { $say('Canvass was closed, so the background worker stops too.'); exit(0); } }
    try { $r = lf_tick(20, 'loop'); if (!empty($r['steps'])) $say("Worked through {$r['steps']} step(s); {$r['pending']} job(s) waiting."); }
    catch (Throwable $e) { $say('Error: ' . $e->getMessage()); }
    lf_kv_set('worker', ['at' => time(), 'mode' => 'loop']);
    sleep(!empty($r['pending']) ? 1 : 3);
  }
}
// one cron run: keep working for ~50 seconds, then stop before the next run starts
$end = microtime(true) + 50; $total = 0;
do { $r = lf_tick(max(5, $end - microtime(true)), 'cron'); $total += $r['steps'] ?? 0; if (!empty($r['busy']) || empty($r['pending'])) break; } while (microtime(true) < $end);
lf_kv_set('worker', ['at' => time(), 'mode' => 'cron']);
$say("Done: $total step(s).");
