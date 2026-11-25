<?php
/* HTTP API against a real local server: sign-in, security, Lead Finder actions, pipeline hand-off, Accounts, Pitch HQ actions. */
$dir = sys_get_temp_dir() . '/canvass-http-' . bin2hex(random_bytes(4)); @mkdir($dir, 0700, true);
$port = 0; $sock = stream_socket_server('tcp://127.0.0.1:0'); $port = (int) explode(':', stream_socket_get_name($sock, false))[1]; fclose($sock);
$root = realpath(__DIR__ . '/..');
$proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", "$root/router.php"], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, $root, ['CANVASS_DATA_DIR' => $dir] + getenv());
register_shutdown_function(function () use ($proc) { proc_terminate($proc); });
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
$base = "http://127.0.0.1:$port/";
$jars = [];
$call = function (string $who, string $method, string $path, $body = null, bool $hdr = true) use ($base, &$jars, $dir) {
  $jar = $jars[$who] ??= "$dir/cookies-$who.txt";
  $ch = curl_init($base . $path); $h = $hdr ? ['X-Canvass: 1', 'Content-Type: application/json'] : ['Content-Type: application/json'];
  curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $h, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_HEADER => true, CURLOPT_TIMEOUT => 60]);
  if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
  $raw = curl_exec($ch); $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $hs = curl_getinfo($ch, CURLINFO_HEADER_SIZE); curl_close($ch);
  $text = substr((string) $raw, $hs); $data = json_decode($text, true);
  return ['status' => $status, 'data' => $data ?? $text, 'headers' => substr((string) $raw, 0, $hs)];
};
$get = fn($who, $a) => $call($who, 'GET', 'api.php?a=' . $a);
$post = fn($who, $a, $b = []) => $call($who, 'POST', 'api.php?a=' . $a, $b);

test('signed-out visitors get nothing, and sign-in is required', function () use ($get, $post) {
  eq($get('x', 'me')['data']['user'], null); eq($get('x', 'lf_dashboard')['status'], 401); eq($get('x', 'sync')['status'], 401);
  eq($post('x', 'login', ['username' => 'MSB', 'password' => 'wrong'])['status'], 401);
  eq($post('admin', 'login', ['username' => 'MSB', 'password' => 'admin'])['status'], 200);
  eq($post('scout', 'login', ['username' => 'Amal', 'password' => '0000'])['status'], 200);
  eq($get('admin', 'me')['data']['user']['isAdmin'], true);
});
test('write requests without the app header are refused (cross-site protection)', function () use ($call) {
  eq($call('admin', 'POST', 'api.php?a=lf_demo_load', [], false)['status'], 400);
});
test('too many wrong passwords lock the login for a while', function () use ($post) {
  for ($i = 0; $i < 10; $i++) $post('brute', 'login', ['username' => 'nobody', 'password' => 'x']);
  eq($post('brute', 'login', ['username' => 'MSB', 'password' => 'admin'])['status'], 429);
});
test('API keys are masked, clamped, admin-only and never in backups', function () use ($get, $post) {
  $r = $post('admin', 'lf_settings_save', ['googlePlacesKey' => 'AIzaSECRETKEY1234']);
  eq($r['status'], 200); eq($r['data']['googlePlacesKey'], '••••1234'); eq($r['data']['googlePlacesKeyConfigured'], true);
  $again = $post('admin', 'lf_settings_save', ['googlePlacesKey' => '••••1234', 'eligibilityYears' => 99]);
  eq($again['data']['eligibilityYears'], 20, 'values are clamped'); eq($again['data']['googlePlacesKeyConfigured'], true);
  $post('admin', 'lf_settings_save', ['eligibilityYears' => 5]);
  eq($post('scout', 'lf_settings_save', ['eligibilityYears' => 3])['status'], 403);
  ok_(!str_contains(json_encode($get('scout', 'lf_settings')['data']), 'SECRETKEY'));
  $bk = $get('admin', 'lf_backup_download'); eq($bk['status'], 200); ok_(!str_contains((string) json_encode($bk['data']), 'SECRETKEY'), 'backup excludes keys');
  $post('admin', 'lf_settings_save', ['googlePlacesKey' => '']);
});
test('demo data loads, is labelled, and powers the dashboard only in demo mode', function () use ($get, $post) {
  eq($post('admin', 'lf_demo_load')['data']['loaded'], 10);
  $d = $get('admin', 'lf_dashboard')['data']; eq($d['demoMode'], true); eq($d['totals']['discovered'], 10);
  $k = array_keys($d['charts']['validation']); sort($k); eq($k, ['No Opportunity', 'Qualified', 'Rejected', 'Unverified']);
  foreach ($get('admin', 'lf_companies&category=all&size=50')['data']['items'] as $c) ok_(str_starts_with($c['name'], '[DEMO]') && $c['demo']);
  eq($post('scout', 'lf_demo_clear')['status'], 403, 'only the admin');
});
test('pipeline: only qualified leads (unless confirmed); demo never; real leads become Canvass businesses', function () use ($get, $post) {
  $q = $get('admin', 'lf_companies&category=Qualified')['data']['items'][0];
  eq($post('admin', 'lf_to_pipeline', ['id' => $q['id']])['status'], 400, 'demo records stay out of the pipeline');
  $post('admin', 'lf_bulk', ['text' => "Pipeline Test Co", 'fileName' => 'one']);
  for ($i = 0; $i < 20 && ($get('admin', 'lf_jobs')['data']['jobs'][0]['status'] ?? '') !== 'done'; $i++) $post('admin', 'lf_tick');
  $c = $get('admin', 'lf_companies&category=all&q=Pipeline')['data']['items'][0]; eq($c['category'], 'Unverified');
  $r = $post('admin', 'lf_to_pipeline', ['id' => $c['id']]); eq($r['status'], 409); match_('/Only qualified/', $r['data']['error']);
  $r = $post('admin', 'lf_to_pipeline', ['id' => $c['id'], 'force' => true]); eq($r['status'], 200);
  $sync = $get('scout', 'sync')['data']; $b = current(array_filter($sync['businesses'], fn($x) => ($x['lfId'] ?? '') === $c['id']));
  ok_((bool) $b, 'the whole team sees it'); eq($b['status'], 'lead'); eq($b['ownerId'], null);
  $GLOBALS['hqid'] = $b['id']; $GLOBALS['lfid'] = $c['id'];
});
test('contact log: 14-day repeat warning, do-not-contact, and the pipeline card moves to Pitched', function () use ($get, $post) {
  $id = $GLOBALS['lfid'];
  eq($post('scout', 'lf_contact_log', ['id' => $id, 'channel' => 'email'])['status'], 200);
  $b = current(array_filter($get('admin', 'sync')['data']['businesses'], fn($x) => $x['id'] === $GLOBALS['hqid']));
  eq($b['status'], 'pitched'); ok_(!empty($b['ownerId']), 'claimed by whoever sent it');
  $dup = $post('scout', 'lf_contact_log', ['id' => $id, 'channel' => 'email']); eq($dup['status'], 409); match_('/Already contacted/', $dup['data']['error']);
  eq($post('scout', 'lf_contact_log', ['id' => $id, 'channel' => 'email', 'force' => true])['status'], 200);
  $post('scout', 'lf_company_patch', ['id' => $id, 'doNotContact' => true]);
  eq($post('scout', 'lf_contact_log', ['id' => $id, 'channel' => 'whatsapp'])['status'], 409);
});
test('evidence requires a source and re-validates immediately', function () use ($get, $post) {
  $c = $get('admin', 'lf_companies&category=Unverified&q=Nomad')['data']['items'][0];
  eq($post('admin', 'lf_evidence', ['id' => $c['id'], 'type' => 'establishment', 'date' => '2024-01-10'])['status'], 400);
  eq($post('admin', 'lf_evidence', ['id' => $c['id'], 'type' => 'establishment', 'date' => '2999-01-01', 'source' => 'Licence 1'])['status'], 400);
  $r = $post('admin', 'lf_evidence', ['id' => $c['id'], 'type' => 'establishment', 'date' => '2024-01-10', 'source' => 'DEMO licence 555']);
  eq($r['status'], 200); eq($r['data']['age']['status'], 'Verified'); eq($r['data']['validation']['category'], 'Qualified'); eq($r['data']['pipeline']['inPipeline'], false, 'demo data never enters the pipeline');
});
test('exports exclude Google content by default and produce CSV', function () use ($get, $post, $call) {
  $t = $get('admin', 'lf_export&dataset=all')['data']; ok_(!in_array('Google rating', $t['header'], true)); match_('/excluded/', $t['note']);
  $post('admin', 'lf_settings_save', ['includeGoogleContentInExports' => true]); ok_(in_array('Google rating', $get('admin', 'lf_export&dataset=all')['data']['header'], true));
  $post('admin', 'lf_settings_save', ['includeGoogleContentInExports' => false]);
  $csv = $call('admin', 'GET', 'api.php?a=lf_export&dataset=qualified&format=csv'); match_('/content-type: text\/csv/i', $csv['headers']); match_('/Company/', $csv['data']);
});
test('clearing demo data turns demo mode off and leaves production figures', function () use ($get, $post) {
  ok_($post('admin', 'lf_demo_clear')['data']['removed'] >= 10);
  $d = $get('admin', 'lf_dashboard')['data']; eq($d['demoMode'], false); eq($d['totals']['discovered'], 1);
});
test('a v1.0 backup file restores through the API (admin only)', function () use ($post) {
  $v1 = ['meta' => ['schema' => 1], 'settings' => [], 'companies' => ['cmp_z' => ['id' => 'cmp_z', 'name' => 'From Windows', 'validation' => ['category' => 'Qualified'], 'score' => ['total' => 81, 'priority' => 'High'], 'contact' => [], 'issues' => [], 'services' => [], 'pipeline' => ['inPipeline' => true, 'stage' => 'Contacted']]], 'searches' => [], 'duplicates' => []];
  eq($post('scout', 'lf_restore', $v1)['status'], 403);
  $r = $post('admin', 'lf_restore', $v1); eq($r['status'], 200); eq($r['data']['restored'], 1); eq($r['data']['addedToPipeline'], 1);
});
test('accounts: password-locked, set by the admin, amounts hidden while locked', function () use ($get, $post) {
  eq($post('scout', 'acc_unlock', ['password' => 'whatever'])['status'], 403, 'scouts can’t create the password');
  eq($post('admin', 'acc_save', ['entry' => ['id' => 'e1', 'type' => 'expense', 'amount' => 5]])['status'], 423, 'locked');
  eq($post('admin', 'acc_unlock', ['password' => '123'])['status'], 400, 'too short');
  $r = $post('admin', 'acc_unlock', ['password' => 'partners1']); eq($r['status'], 200); eq($r['data']['created'], true);
  eq($post('admin', 'acc_save', ['entry' => ['id' => 'e1', 'type' => 'income', 'amount' => 4500, 'cat' => 'Client payment', 'note' => 'Advance']])['status'], 200);
  eq($post('admin', 'acc_save', ['entry' => ['id' => 'e2', 'type' => 'expense', 'amount' => -3]])['status'], 400);
  eq($post('admin', 'rec_save', ['item' => ['id' => 'r1', 'name' => 'Hosting', 'amount' => 420, 'freq' => 'yearly', 'next' => '2027-01-01', 'remind' => 14]])['status'], 200);
  eq($post('scout', 'acc_unlock', ['password' => 'nope'])['status'], 403);
  $s = $get('scout', 'sync')['data']; eq($s['rec'][0]['name'], 'Hosting'); eq($s['rec'][0]['amount'], null, 'no amounts while locked'); eq($s['accHasPw'], true);
  $u = $post('scout', 'acc_unlock', ['password' => 'partners1'])['data']; eq($u['entries'][0]['amount'], 4500); eq($u['rec'][0]['amount'], 420);
  eq($post('scout', 'acc_setpw', ['current' => 'partners1', 'password' => 'newpass1'])['status'], 403, 'only the admin changes it');
  eq($post('admin', 'acc_setpw', ['current' => 'partners1', 'password' => 'newpass1'])['status'], 200);
  eq($post('scout', 'acc_delete', ['id' => 'e1'])['status'], 423, 'others must unlock again after a password change');
  $post('admin', 'acc_lock'); eq($post('admin', 'acc_delete', ['id' => 'e1'])['status'], 423);
});
test('Pitch HQ actions still work: create, claim race, helpers, activity, delete rules', function () use ($get, $post) {
  eq($post('scout', 'biz_set', ['id' => 'b_test1', 'data' => ['name' => 'Hand Added', 'status' => 'lead']])['status'], 200);
  eq($post('admin', 'claim', ['id' => 'b_test1'])['status'], 200);
  $r = $post('scout', 'claim', ['id' => 'b_test1']); eq($r['status'], 409); eq($r['data']['taken'], true);
  eq($post('scout', 'biz_update', ['id' => 'b_test1', 'patch' => ['status' => 'won']])['status'], 403);
  eq($post('scout', 'act_add', ['id' => 'b_test1', 'act' => ['type' => 'note', 'note' => 'Called them']])['status'], 200);
  eq($post('scout', 'biz_update', ['id' => 'b_test1', 'patch' => ['lfId' => 'fake', 'notes' => 'x']])['status'], 403, 'not the owner');
  eq($post('admin', 'biz_update', ['id' => 'b_test1', 'patch' => ['lfId' => 'fake', 'notes' => 'ok']])['status'], 200);
  ok_(!isset(current(array_filter($get('admin', 'sync')['data']['businesses'], fn($b) => $b['id'] === 'b_test1'))['lfId']), 'the Lead Finder link can’t be set by hand');
  eq($post('admin', 'biz_delete', ['id' => 'b_test1'])['status'], 200);
  $post('admin', 'member_update', ['mentionsSeen' => 12345]);
  eq(current(array_filter($get('admin', 'sync')['data']['members'], fn($m) => $m['isAdmin']))['mentionsSeen'], 12345, 'mentions read state is saved');
});
test('the code library and data are never served', function () use ($call) {
  foreach (['lib/core.php', 'lib/lf/store.php', 'router.php', 'cron.php', 'tests/run.php'] as $p) eq($call('x', 'GET', $p)['status'], 403, $p);
  eq($call('x', 'GET', '')['status'], 200);
});
