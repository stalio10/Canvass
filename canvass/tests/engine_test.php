<?php
/* Engine: duplicate detection, bulk parsing, Google discovery with a mocked Places API, failures, missing information,
 * pipeline hand-off to Canvass, Google data retention, backups (including v1.0 backups). */
$iso = fn($d) => iso_ago($d);
$place = fn($id, $over = []) => array_merge(['id' => "PLACE_{$id}_abcdefgh", 'displayName' => ['text' => $over['name'] ?? "Biz $id"], 'formattedAddress' => "Office $id, Al Quoz, Dubai", 'location' => ['latitude' => 25, 'longitude' => 55],
  'addressComponents' => [['longText' => 'Al Quoz', 'types' => ['sublocality']], ['longText' => 'Dubai', 'types' => ['locality']], ['longText' => 'United Arab Emirates', 'shortText' => 'AE', 'types' => ['country']]],
  'googleMapsUri' => "https://maps.google.com/?cid=$id", 'businessStatus' => 'OPERATIONAL', 'nationalPhoneNumber' => '04 555 00' . str_pad((string) $id, 2, '0', STR_PAD_LEFT),
  'regularOpeningHours' => ['weekdayDescriptions' => ['Mon 9-6']], 'rating' => 4.5, 'userRatingCount' => 8, 'reviews' => [['rating' => 5, 'text' => ['text' => 'Great team'], 'publishTime' => iso_ago(20)]],
  'photos' => [[]], 'primaryType' => 'interior_designer', 'types' => ['interior_designer', 'point_of_interest']], $over);
/** Mock network: Places pages, RDAP, archive, PageSpeed (quota error) and some websites. */
function mock_net($pages, array $sites = []): array {
  $calls = new ArrayObject();
  LfHttp::$transport = function ($u, $o) use ($pages, $sites, $calls) {
    $calls[] = $u;
    if (str_contains($u, 'places.googleapis.com')) {
      $body = json_decode($o['body'] ?? '{}', true) ?: []; $idx = !empty($body['pageToken']) ? (int) $body['pageToken'] : 0;
      if (is_callable($pages)) return $pages($body);
      return resp(200, ['places' => $pages[$idx] ?? []] + (isset($pages[$idx + 1]) ? ['nextPageToken' => (string) ($idx + 1)] : []));
    }
    if (str_contains($u, 'generate_204')) return resp(204, '');
    if (str_contains($u, 'rdap.org')) return resp(200, ['events' => [['eventAction' => 'registration', 'eventDate' => iso_ago(700)]]]);
    if (str_contains($u, 'web.archive.org')) return resp(200, [['timestamp', 'original'], [gmdate('Ymd', time() - 650 * 86400) . '000000', 'http://x']]);
    if (str_contains($u, 'pagespeedonline')) return resp(429, ['error' => ['message' => 'Quota exceeded']]);
    foreach ($sites as $host => $body) if (str_contains($u, $host)) return is_int($body) ? resp($body, '') : resp(200, $body);
    return resp(404, '');
  };
  return (array) $calls;
}
$byName = fn($n) => current(array_filter(lf_companies_all(), fn($c) => $c['name'] === $n));

test('bulk input parsing: headers, aliases, plain URL lists, Maps links', function () {
  $rows = lf_normalize_bulk_input(['rows' => [['Company Name', 'Website URL', 'Phone Number', 'Google Maps Link'], ['Olive LLC', 'olive.ae', '050', ''], ['', '', '', 'https://maps.app.goo.gl/abc'], ['', '', '', '']]]);
  eq(count($rows), 2); eq($rows[0]['name'], 'Olive LLC'); eq($rows[0]['website'], 'olive.ae'); eq($rows[1]['mapsLink'], 'https://maps.app.goo.gl/abc');
  $lines = lf_normalize_bulk_input(['text' => "https://a.ae\nBeta Trading\nhttps://www.google.com/maps/place/Gamma+Cafe/@25.1,55.2,17z\ninstagram.com/foo"]);
  eq(array_map(fn($r) => array_key_first($r), $lines), ['website', 'name', 'mapsLink', 'name']);
  eq(lf_parse_maps_link('https://www.google.com/maps/place/Gamma+Cafe/@25.1,55.2,17z')['name'], 'Gamma Cafe');
  eq(lf_parse_maps_link('https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJabc123xyz')['placeId'], 'ChIJabc123xyz');
});
test('duplicate detection by Place ID, domain, phone, name+location and name↔domain', function () {
  reset_db();
  $a = lf_new_record(['name' => 'Olive Interiors LLC', 'city' => 'Dubai']); $a['google'] = ['placeId' => 'P1']; $a['contact'] = ['phone' => '+971 50 123 4567', 'website' => 'https://www.oliveinteriors.ae/']; $a['website'] = ['domain' => 'oliveinteriors.ae'];
  lf_company_put($a);
  $cand = fn($over) => array_merge(lf_new_record(['name' => 'Other', 'city' => 'Dubai']), $over);
  eq(lf_find_duplicate($cand(['google' => ['placeId' => 'P1']]))['by'], 'Google Place ID');
  eq(lf_find_duplicate($cand(['contact' => ['website' => 'http://oliveinteriors.ae/about']]))['by'], 'website domain');
  eq(lf_find_duplicate($cand(['contact' => ['phone' => '050 123 4567']]))['by'], 'phone number');
  eq(lf_find_duplicate($cand(['name' => 'OLIVE INTERIORS L.L.C']))['by'], 'business name and location');
  eq(lf_find_duplicate($cand(['name' => 'Olive Interiors', 'city' => 'Sharjah']))['by'], 'business name matches website domain');
  eq(lf_find_duplicate($cand(['name' => 'Different Co', 'contact' => ['phone' => '04 999 1111']])), null);
});
test('Google discovery end-to-end: pagination, dedupe, validation, hand-off to the Canvass pipeline', function () use ($place, $byName) {
  reset_db(); settings_for_tests();
  $site = '<html><head><title>Biz</title><meta name="viewport" content="width=device-width"></head><body><h1>Biz</h1></body></html>';
  $calls = mock_net([[$place(1, ['websiteUri' => 'https://biz1.example/']), $place(2), $place(3, ['businessStatus' => 'CLOSED_PERMANENTLY'])],
    [$place(4, ['formattedAddress' => 'Corniche, Abu Dhabi', 'addressComponents' => [['longText' => 'Abu Dhabi', 'types' => ['locality']], ['longText' => 'United Arab Emirates', 'shortText' => 'AE', 'types' => ['country']]]]), $place(5, ['userRatingCount' => 4000]), $place(1)]], ['biz1.example' => $site]);
  $job = lf_start_discovery(['city' => 'Dubai', 'country' => 'United Arab Emirates', 'industryId' => 'interior-design', 'count' => 10]); run_jobs();
  $done = lf_job_get($job['id']); eq($done['status'], 'done', $done['error'] ?? '');
  eq(count(lf_companies_all()), 5, 'place 1 appears twice but is stored once');
  eq($byName('Biz 3')['validation']['category'], 'Rejected'); match_('/Closed permanently/', $byName('Biz 3')['validation']['reasons'][0]);
  eq($byName('Biz 4')['validation']['category'], 'Rejected'); match_('/outside Dubai/', implode(',', $byName('Biz 4')['validation']['reasons']));
  eq($byName('Biz 5')['validation']['category'], 'Rejected'); match_('/large/', implode(',', $byName('Biz 5')['validation']['reasons']));
  $c = $byName('Biz 1'); eq($c['validation']['category'], 'Unverified'); eq($c['pipeline']['inPipeline'], false);
  ok_((bool) array_filter($c['age']['evidence'], fn($e) => $e['kind'] === 'domain'), 'RDAP evidence recorded with source');
  eq(count(lf_kv_get('searches', [])), 1); eq((int) db()->query('SELECT COUNT(*) FROM businesses')->fetchColumn(), 0, 'nothing unqualified reaches the pipeline');
  // the team records a documented licence date → re-validated → qualified → added to the Canvass pipeline automatically
  $c['manual']['establishment'] = ['date' => gmdate('Y-m-d', time() - 400 * 86400), 'source' => 'DED licence 123', 'enteredAt' => lf_now_iso()];
  lf_process_company($c, ['settings' => lf_settings(), 'offline' => true]); lf_save($c);
  eq($c['validation']['category'], 'Qualified', implode(',', $c['validation']['reasons'])); eq($c['pipeline']['inPipeline'], true); ok_(str_contains($c['pitch']['email'], 'Biz 1'));
  $b = getBiz($c['pipeline']['hqId']); ok_((bool) $b, 'a Canvass business was created');
  eq([$b['status'], $b['ownerId'], $b['lfId'], $b['name']], ['lead', null, $c['id'], 'Biz 1']);
  ok_(!isset($b['google']['rating']), 'no Google ratings copied into the pipeline'); match_('/From Lead Finder/', $b['notes']);
  lf_save($c); eq((int) db()->query('SELECT COUNT(*) FROM businesses')->fetchColumn(), 1, 'never added twice');
});
test('accepting consistent estimates qualifies companies without manual dates', function () use ($place) {
  reset_db(); settings_for_tests(['acceptEstimatedAge' => true]);
  mock_net([[$place(7, ['websiteUri' => 'https://biz7.example/'])]], ['biz7.example' => '<html><body>tiny</body></html>']);
  lf_start_discovery(['city' => 'Dubai', 'industryId' => 'interior-design', 'count' => 1]); run_jobs();
  $c = lf_companies_all()[0]; eq($c['age']['status'], 'Estimated'); eq($c['age']['acceptedEstimate'], true); eq($c['validation']['category'], 'Qualified'); eq($c['pipeline']['inPipeline'], true);
  ok_(!empty($c['pipeline']['hqId']) && getBiz($c['pipeline']['hqId']), 'in the Canvass pipeline');
});
test('automatic pipeline hand-off can be switched off', function () use ($place) {
  reset_db(); settings_for_tests(['acceptEstimatedAge' => true, 'autoAddToPipeline' => false]);
  mock_net([[$place(8, ['websiteUri' => 'https://biz8.example/'])]], ['biz8.example' => '<html><body>tiny</body></html>']);
  lf_start_discovery(['city' => 'Dubai', 'industryId' => 'interior-design', 'count' => 1]); run_jobs();
  $c = lf_companies_all()[0]; eq($c['validation']['category'], 'Qualified'); eq($c['pipeline']['inPipeline'], false); eq((int) db()->query('SELECT COUNT(*) FROM businesses')->fetchColumn(), 0);
});
test('Places API failure stops the job with a clear message and stores nothing fake', function () {
  reset_db(); settings_for_tests(); mock_net(fn() => resp(403, ['error' => ['message' => 'API key not valid']]));
  $job = lf_start_discovery(['city' => 'Dubai', 'industryId' => 'interior-design', 'count' => 5]); run_jobs();
  $d = lf_job_get($job['id']); eq($d['status'], 'failed'); match_('/API key not valid/', $d['error']); match_('/Places API \(New\) is enabled/', $d['error']); eq(count(lf_companies_all()), 0);
});
test('discovery refuses to start without an API key', function () { reset_db(); throws(fn() => lf_start_discovery(['city' => 'Dubai', 'industryId' => 'interior-design']), '/Google Places API key/'); });
test('HTTP retries on 429 then succeeds', function () {
  $n = 0; LfHttp::$transport = function () use (&$n) { return ++$n < 2 ? resp(429, 'busy', ['retry-after' => '0']) : resp(200, ['ok' => true]); };
  eq(LfHttp::fetch('https://api.example/x', ['api' => 'rdap', 'retries' => 2])['status'], 200); eq($n, 2);
});
test('private network addresses are blocked (SSRF guard)', function () {
  LfHttp::$transport = null;
  throws(fn() => LfHttp::fetch('http://127.0.0.1/admin', ['guard' => true, 'retries' => 0]), '/Private/');
  throws(fn() => LfHttp::fetch('http://localhost:4321/api', ['guard' => true, 'retries' => 0]), '/Private/');
  throws(fn() => LfHttp::fetch('http://10.0.0.5/', ['guard' => true, 'retries' => 0]), '/Private/');
  throws(fn() => LfHttp::fetch('file:///etc/passwd', ['guard' => true, 'retries' => 0]), '/http/');
  ok_(lf_is_private_ip('169.254.169.254') && lf_is_private_ip('::1') && lf_is_private_ip('::ffff:192.168.1.1') && !lf_is_private_ip('8.8.8.8'));
});
test('bulk upload without Google key: missing information stays Unverified, never invented', function () {
  reset_db(); settings_for_tests(['googlePlacesKey' => '']); $s = lf_settings(); $s['googlePlacesKey'] = ''; lf_settings_save($s);
  mock_net([], ['shop.example' => '<html><head><title>Shop</title></head><body><a href="mailto:info@shop.example">mail</a></body></html>']);
  $job = lf_start_bulk(['rows' => [['Company', 'Website'], ['Shop One', 'https://shop.example'], ['Shop One', 'shop.example'], ['Name Only Co', '']], 'fileName' => 'test.xlsx']); run_jobs();
  $d = lf_job_get($job['id']); eq($d['counts']['Duplicates'] ?? 0, 1, 'same company repeated in the file');
  $list = lf_companies_all(); eq(count($list), 2);
  foreach ($list as $c) { eq($c['validation']['category'], 'Unverified'); eq($c['pipeline']['inPipeline'], false); eq($c['google'], null); eq($c['pitch'], null); }
  $shop = current(array_filter($list, fn($c) => $c['name'] === 'Shop One')); eq($shop['contact']['email'], 'info@shop.example'); eq($shop['contactSources']['email'], 'Website: shop.example');
  $no = current(array_filter($list, fn($c) => $c['name'] === 'Name Only Co')); eq($no['websiteStatus'], 'Not found'); eq($no['age']['status'], 'Not Available');
  eq(current(array_filter($no['issues'], fn($i) => $i['id'] === 'no-website-found'))['status'], 'Potential Improvement', 'missing data is not a confirmed issue');
});
test('our own connection failure is not reported as the website being down', function () {
  reset_db(); settings_for_tests(['googlePlacesKey' => '']);
  LfHttp::$transport = fn($u) => ['error' => 'Could not resolve proxy'];
  $a = lf_audit_website('https://some-business.example/', ['runPageSpeed' => false, 'brokenLinkSample' => 0]);
  eq($a['availability']['networkProblem'] ?? false, true); eq($a['issues'], []);
});
test('Quick add “check fully” links the report to the business that was added by hand', function () {
  reset_db(); settings_for_tests(['googlePlacesKey' => '']);
  mock_net([], ['quick.example' => '<html><head><title>Quick</title></head><body>hello</body></html>']);
  $hq = 'manual1'; putBiz($hq, ['name' => 'Quick Cafe', 'status' => 'claimed', 'ownerId' => 'u1', 'createdBy' => 'u1']);
  lf_start_bulk(['rows' => [['Company', 'Website'], ['Quick Cafe', 'quick.example']], 'fileName' => 'Quick add: Quick Cafe', 'quick' => true, 'linkHq' => $hq]); run_jobs();
  $c = lf_companies_all()[0]; eq($c['pipeline']['hqId'], $hq); $b = getBiz($hq); eq($b['lfId'], $c['id']); eq($b['status'], 'claimed', 'stage left alone');
});
test('Google content is purged after the retention period; Place ID kept; Canvass copy cleaned too', function () use ($place) {
  reset_db();
  $c = lf_new_record(['name' => 'Old']); lf_merge_google($c, lf_google_block($place(9)));
  $c['google']['fetchedAt'] = iso_ago(31); $c['pipeline']['inPipeline'] = true; $c['validation'] = ['category' => 'Qualified']; $c['score'] = ['total' => 80, 'priority' => 'High'];
  lf_company_put($c); lf_hq_transfer($c);
  eq(getBiz($c['pipeline']['hqId'])['phone'], '04 555 0009');
  eq(lf_purge_expired_google(), 1);
  $a = lf_company_get($c['id']); eq($a['google']['placeId'], 'PLACE_9_abcdefgh'); ok_(!isset($a['google']['rating']) && !isset($a['google']['reviews']));
  ok_(!isset($a['contact']['phone']), 'Google-only phone removed'); eq($a['google']['expired'], true);
  eq(getBiz($c['pipeline']['hqId'])['phone'], '', 'Google-only phone removed from the pipeline card too');
});
test('backups exclude API keys, restore round-trips and keeps this server’s keys', function () {
  reset_db(); $s = lf_settings(); $s['googlePlacesKey'] = 'SECRET'; lf_settings_save($s);
  $c = lf_new_record(['name' => 'Keep me']); lf_company_put($c);
  $ex = lf_state_export(); eq($ex['settings']['googlePlacesKey'], ''); ok_(!str_contains(json_encode($ex), 'SECRET'));
  $s['googlePlacesKey'] = 'MINE'; lf_settings_save($s);
  eq(lf_restore(json_encode($ex)), 1); eq(lf_settings()['googlePlacesKey'], 'MINE', 'restore keeps this server’s key');
  throws(fn() => lf_restore('{"nope":1}'), '/Not a Canvass/');
});
test('a v1.0 (Windows app) backup imports, and its pipeline leads join the Canvass pipeline once', function () {
  reset_db();
  $v1 = ['meta' => ['schema' => 1], 'settings' => ['eligibilityYears' => 5, 'budget' => ['enabled' => true, 'placesMonthlyLimit' => 900, 'placesDailyLimit' => 50]], 'companies' => [
    'cmp_a' => ['id' => 'cmp_a', 'name' => 'Won Co', 'createdAt' => iso_ago(10), 'validation' => ['category' => 'Qualified'], 'score' => ['total' => 85, 'priority' => 'High'], 'contact' => ['phone' => '050'], 'issues' => [], 'services' => [], 'pipeline' => ['inPipeline' => true, 'stage' => 'Won', 'history' => [], 'notes' => [], 'contactLog' => []]],
    'cmp_b' => ['id' => 'cmp_b', 'name' => 'New Co', 'createdAt' => iso_ago(9), 'validation' => ['category' => 'Qualified'], 'score' => ['total' => 70, 'priority' => 'Medium'], 'contact' => [], 'issues' => [], 'services' => [], 'pipeline' => ['inPipeline' => true, 'stage' => 'New', 'history' => [], 'notes' => [], 'contactLog' => []]],
    'cmp_c' => ['id' => 'cmp_c', 'name' => 'Rejected Co', 'createdAt' => iso_ago(8), 'validation' => ['category' => 'Rejected'], 'contact' => [], 'pipeline' => ['inPipeline' => false]]],
    'searches' => [['id' => 'job_1', 'type' => 'Google discovery']], 'duplicates' => [], 'usage' => [], 'billing' => ['months' => [lf_pacific(null, false) => ['places' => 12]], 'days' => []], 'jobs' => []];
  require_once __DIR__ . '/../lib/lf/api.php';
  eq(lf_restore($v1), 3); eq(lf_sync_pipeline(null), 2); eq(lf_sync_pipeline(null), 0, 'only once');
  $st = []; foreach (db()->query('SELECT data FROM businesses') as $r) { $b = json_decode($r['data'], true); $st[$b['name']] = $b['status']; }
  eq($st, ['Won Co' => 'won', 'New Co' => 'lead']); eq(lf_budget_status()['used'], 12, 'Google usage this month carried over');
});
