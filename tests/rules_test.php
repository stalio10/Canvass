<?php
/* Mandatory validation rules, age/activity logic, scoring and services — pure functions, no network. */
$S = lf_defaults(); $TODAY = (float) strtotime('2026-11-24T12:00:00Z');
$ago = fn($days) => gmdate('Y-m-d', (int) ($TODAY - $days * 86400));
$goodGoogle = fn($over = []) => array_merge(['placeId' => 'p1', 'fetchedAt' => gmdate('c', (int) $TODAY), 'businessStatus' => 'OPERATIONAL', 'formattedAddress' => 'Al Quoz, Dubai', 'location' => ['latitude' => 1, 'longitude' => 1],
  'nationalPhoneNumber' => '04 1234567', 'regularOpeningHours' => ['weekdayDescriptions' => ['Mon 9-5']], 'reviews' => [['rating' => 5, 'text' => 'Great', 'publishTime' => gmdate('c', (int) $TODAY)]], 'types' => ['interior_designer'], 'userRatingCount' => 12], $over);
$lead = fn($over = []) => array_merge(['name' => 'Test Interiors', 'contact' => ['phone' => '0501234567', 'website' => 'https://t.example'], 'google' => $goodGoogle(),
  'activity' => ['status' => 'Verified', 'signals' => 4, 'recentSignals' => 1], 'age' => ['status' => 'Verified', 'withinWindow' => true, 'basis' => 'Documented', 'yearsOld' => 1.5, 'notes' => []],
  'industryCheck' => ['status' => 'Relevant'], 'locationCheck' => ['status' => 'Matching'], 'sizeCheck' => ['status' => 'SME'],
  'issues' => [['id' => 'x', 'area' => 'website', 'status' => 'Confirmed Issue', 'title' => 'Missing meta description', 'services' => ['Technical SEO']]]], $over);

test('qualified only when every mandatory rule passes', fn() => eq(lf_validate($lead(), $S)['category'], 'Qualified'));
test('closed businesses are rejected', function () use ($lead, $S) { foreach (['Closed permanently', 'Closed temporarily'] as $st) eq(lf_validate($lead(['activity' => ['status' => $st]]), $S)['category'], 'Rejected'); });
test('older age evidence does not block a website opportunity', function () use ($lead, $S) { $v = lf_validate($lead(['age' => ['status' => 'Verified', 'withinWindow' => false, 'notes' => ['Established 2015']]]), $S); eq($v['category'], 'Qualified'); });
test('unverified age does not block a website opportunity', fn() => eq(lf_validate($lead(['age' => ['status' => 'Estimated', 'withinWindow' => null, 'notes' => ['Supporting evidence only']]]), $S)['category'], 'Qualified'));
test('unverified activity, uncertain industry, unknown location → Unverified', function () use ($lead, $S) {
  eq(lf_validate($lead(['activity' => ['status' => 'Unverified', 'note' => 'x']]), $S)['category'], 'Unverified');
  eq(lf_validate($lead(['industryCheck' => ['status' => 'Uncertain', 'note' => 'x']]), $S)['category'], 'Unverified');
  eq(lf_validate($lead(['locationCheck' => ['status' => 'Unknown', 'note' => 'x']]), $S)['category'], 'Unverified');
});
test('irrelevant industry, out of location, large, duplicate, invalid → Rejected', function () use ($lead, $S) {
  foreach ([['industryCheck' => ['status' => 'Irrelevant', 'note' => 'x']], ['locationCheck' => ['status' => 'Out of location', 'note' => 'x']], ['sizeCheck' => ['status' => 'Large', 'note' => 'x']], ['duplicateOf' => 'cmp_1'], ['invalid' => 'Fake listing']] as $o)
    eq(lf_validate($lead($o), $S)['category'], 'Rejected', json_encode($o));
});
test('no public contact information does not block a website opportunity', fn() => eq(lf_validate($lead(['contact' => []]), $S)['category'], 'Qualified'));
test('only confirmed website problems qualify; potential or Google-only issues do not', function () use ($lead, $S) {
  $l = $lead(['issues' => [['id' => 'p', 'area' => 'website', 'status' => 'Potential Improvement', 'title' => 'x', 'services' => []]]]);
  eq(lf_validate($l, $S)['category'], 'No Opportunity'); eq(lf_validate($l, ['requireConfirmedIssue' => false] + $S)['category'], 'No Opportunity');
  eq(lf_validate($lead(['issues' => [['id' => 'p', 'area' => 'gbp', 'status' => 'Confirmed Issue', 'title' => 'x', 'services' => []]]]), $S)['category'], 'No Opportunity');
  eq(lf_validate($lead(['issues' => []]), $S)['category'], 'No Opportunity');
});

test('local testing access requires loopback and is disabled for hosted mode', function () {
  $old = $_SERVER; $oldHosted = getenv('CANVASS_HOSTED'); meta_set('local_testing_access', '1');
  $_SERVER['HTTP_HOST'] = 'localhost:4400'; $_SERVER['REMOTE_ADDR'] = '203.0.113.8'; eq(localTestingAccess(), false);
  $_SERVER['REMOTE_ADDR'] = '127.0.0.1'; eq(localTestingAccess(), true);
  putenv('CANVASS_HOSTED=1'); eq(localTestingAccess(), false);
  if ($oldHosted === false) putenv('CANVASS_HOSTED'); else putenv('CANVASS_HOSTED=' . $oldHosted);
  $_SERVER = $old;
});
test('a high score never overrides a failed mandatory rule', function () use ($lead, $S) {
  $l = $lead(['sizeCheck' => ['status' => 'Large', 'note' => 'chain'], 'issues' => array_map(fn($i) => ['id' => "i$i", 'area' => $i % 2 ? 'gbp' : 'website', 'status' => 'Confirmed Issue', 'title' => 't', 'services' => []], range(0, 9))]);
  ok_(lf_score($l, $S)['total'] >= 80, 'score should be high'); eq(lf_validate($l, $S)['category'], 'Rejected');
});
test('score is 0–100 with configurable priority bands', function () use ($lead, $S) {
  $sc = lf_score($lead(), $S); ok_($sc['total'] >= 0 && $sc['total'] <= 100);
  eq($sc['priority'], $sc['total'] >= 80 ? 'High' : ($sc['total'] >= 60 ? 'Medium' : 'Low'));
  $z = lf_score(['issues' => [], 'contact' => []], $S); eq($z['total'], 0); eq($z['priority'], 'Low');
  eq(lf_score($lead(['contact' => ['phone' => '050', 'email' => 'a@b.example', 'website' => 'https://t.example']]), ['weights' => ['age' => 0, 'activity' => 0, 'gbp' => 0, 'website' => 0, 'contact' => 10]] + $S)['total'], 100);
});
test('documented establishment date inside the window verifies age', function () use ($S, $ago, $TODAY) { $a = lf_assess_age(['manual' => ['date' => $ago(400), 'source' => 'DED licence'], 'reviews' => []], $S, $TODAY); eq($a['status'], 'Verified'); eq($a['withinWindow'], true); });
test('documented date older than the window → verified but outside', fn() => eq(lf_assess_age(['manual' => ['date' => $ago(365 * 7), 'source' => 'Licence']], $S, $TODAY)['withinWindow'], false));
test('the five-year window moves with the current date', function () use ($S) {
  eq(lf_assess_age(['manual' => ['date' => '2021-11-01', 'source' => 'x']], $S, (float) strtotime('2026-10-01'))['withinWindow'], true);
  eq(lf_assess_age(['manual' => ['date' => '2021-11-01', 'source' => 'x']], $S, (float) strtotime('2026-12-01'))['withinWindow'], false);
});
test('domain and archive dates alone are only an estimate (not verified)', function () use ($S, $ago, $TODAY) {
  $in = ['rdap' => ['status' => 'Found', 'date' => $ago(600)], 'wayback' => ['status' => 'Found', 'date' => $ago(500)], 'hasWebsite' => true];
  $a = lf_assess_age($in, $S, $TODAY); eq($a['status'], 'Estimated'); eq($a['withinWindow'], null);
  $b = lf_assess_age($in, ['acceptEstimatedAge' => true] + $S, $TODAY); eq($b['withinWindow'], true); eq($b['acceptedEstimate'], true);
});
test('old domain alone does not reject (domain may predate the business)', function () use ($S, $TODAY) { $a = lf_assess_age(['rdap' => ['status' => 'Found', 'date' => '2003-12-17'], 'hasWebsite' => true], $S, $TODAY); eq($a['status'], 'Unverified'); eq($a['withinWindow'], null); });
test('a customer review older than the window proves the business is older', function () use ($S, $ago, $TODAY) { $a = lf_assess_age(['reviews' => [['publishTime' => $ago(365 * 6) . 'T00:00:00Z']]], $S, $TODAY); eq($a['withinWindow'], false); eq($a['status'], 'Verified'); });
test('no evidence → Not Available, never an invented date', function () use ($S, $TODAY) { $a = lf_assess_age(['reviews' => []], $S, $TODAY); eq($a['status'], 'Not Available'); eq($a['earliestDate'], null); eq($a['withinWindow'], null); });
test('a Google listing alone is not proof of activity', fn() => eq(lf_assess_activity(['google' => ['placeId' => 'x', 'fetchedAt' => gmdate('c', (int) $TODAY), 'businessStatus' => 'OPERATIONAL']], $S, $TODAY)['status'], 'Unverified'));
test('operational + recent review + hours + phone → Verified', fn() => eq(lf_assess_activity(['google' => $goodGoogle()], $S, $TODAY)['status'], 'Verified'));
test('few or old reviews do not make a business inactive, just unverified', function () use ($S, $goodGoogle, $ago, $TODAY) {
  $a = lf_assess_activity(['google' => $goodGoogle(['reviews' => [['rating' => 4, 'publishTime' => $ago(900)]]])], $S, $TODAY); eq($a['status'], 'Unverified');
  $b = lf_assess_activity(['google' => $goodGoogle(['reviews' => [['rating' => 4, 'publishTime' => $ago(900)]]]), 'websiteAudit' => ['availability' => ['ok' => true], 'finalUrl' => 'https://x', 'checkedAt' => gmdate('c')]], $S, $TODAY); eq($b['status'], 'Verified');
});
test('closed statuses are detected', fn() => eq(lf_assess_activity(['google' => $goodGoogle(['businessStatus' => 'CLOSED_TEMPORARILY'])], $S)['status'], 'Closed temporarily'));
test('industry relevance uses Google types and keywords', function () use ($S) {
  $ind = $S['industries'];
  eq(lf_assess_industry(['industryId' => 'interior-design', 'google' => ['types' => ['interior_designer']], 'name' => 'X'], $ind)['status'], 'Relevant');
  eq(lf_assess_industry(['industryId' => 'interior-design', 'google' => ['types' => ['restaurant', 'food']], 'name' => 'Tasty Grill'], $ind)['status'], 'Irrelevant');
  eq(lf_assess_industry(['industryId' => 'interior-design', 'google' => ['types' => ['point_of_interest']], 'name' => 'ABC Group'], $ind)['status'], 'Uncertain');
  eq(lf_assess_industry(['industryId' => 'restaurants-cafes', 'google' => ['types' => ['indian_restaurant']], 'name' => 'Spice'], $ind)['status'], 'Relevant');
});
test('location matching rejects other cities and flags unknown addresses', function () {
  $g = fn($city) => ['formattedAddress' => "Street, $city", 'addressComponents' => [['longText' => $city, 'types' => ['locality']], ['longText' => 'United Arab Emirates', 'shortText' => 'AE', 'types' => ['country']]]];
  eq(lf_assess_location(['google' => $g('Dubai'), 'country' => 'United Arab Emirates', 'city' => 'Dubai'])['status'], 'Matching');
  eq(lf_assess_location(['google' => $g('Abu Dhabi'), 'country' => 'United Arab Emirates', 'city' => 'Dubai'])['status'], 'Out of location');
  eq(lf_assess_location(['google' => null, 'country' => 'United Arab Emirates', 'city' => 'Dubai'])['status'], 'Unknown');
});
test('large and chain businesses are detected', function () use ($S) {
  eq(lf_assess_size(['google' => ['userRatingCount' => 5000], 'name' => 'Big'], $S)['status'], 'Large');
  eq(lf_assess_size(['google' => ['userRatingCount' => 30], 'name' => 'Cafe Nero'], $S, ['cafe nero' => 4])['status'], 'Large');
  eq(lf_assess_size(['google' => ['userRatingCount' => 30], 'name' => 'Small Co'], $S)['status'], 'SME');
});
test('services come only from findings and enabled catalogue entries', function () use ($lead, $S) {
  eq(array_column(lf_recommend_services($lead(), $S), 'name'), ['Technical SEO']);
  $off = $S; $off['services'] = array_map(fn($s) => ['enabled' => $s['name'] !== 'Technical SEO'] + $s, $S['services']);
  eq(lf_recommend_services($lead(), $off), []);
});
