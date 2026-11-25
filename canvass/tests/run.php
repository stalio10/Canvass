<?php
/* Runs every Canvass test:  php tests/run.php     (the HTTP tests start a local server on a free port) */
declare(strict_types=1);
require __DIR__ . '/lib.php';
boot_engine();
foreach (['rules_test.php', 'audit_test.php', 'budget_test.php', 'engine_test.php'] as $f) { $GLOBALS['T']['file'] = $f; echo "\n$f\n"; reset_db(); require __DIR__ . "/$f"; }
$GLOBALS['T']['file'] = 'http_test.php'; echo "\nhttp_test.php\n"; require __DIR__ . '/http_test.php';
$t = $GLOBALS['T'];
echo "\n" . ($t['fail'] ? "FAILED" : "PASSED") . ": {$t['pass']} passed, {$t['fail']} failed\n";
foreach ($t['failures'] as $f) echo "  - $f\n";
exit($t['fail'] ? 1 : 0);
