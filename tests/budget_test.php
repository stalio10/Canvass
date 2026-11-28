<?php
/* Free-tier protection: Canvass must refuse Google Places requests beyond the configured limits, before sending them. */
$placeOk = fn($n) => resp(200, ['places' => array_map(fn($i) => ['id' => "PLACE_{$n}_{$i}_abcdefgh", 'displayName' => ['text' => "Biz $n-$i"], 'businessStatus' => 'CLOSED_PERMANENTLY'], range(0, 19)), 'nextPageToken' => 'more']);
$budget = function (int $month, int $day, bool $on = true) { $s = lf_settings(); $s['budget'] = ['enabled' => $on, 'placesMonthlyLimit' => $month, 'placesDailyLimit' => $day]; lf_settings_save($s); };

test('requests stop at the monthly limit and nothing is sent beyond it', function () use ($placeOk, $budget) {
  reset_db(); $budget(3, 100); $sent = 0; LfHttp::$transport = function () use (&$sent, $placeOk) { $sent++; return $placeOk($sent); };
  for ($i = 0; $i < 3; $i++) lf_text_search('KEY', ['textQuery' => 'x']);
  $e = throws(fn() => lf_text_search('KEY', ['textQuery' => 'x']), '/Monthly Google Places limit reached \(3 of 3/'); eq($e->errCode, 'BUDGET');
  eq($sent, 3, 'the 4th request was never sent'); eq(lf_budget_status()['used'], 3);
});
test('daily limit is enforced separately', function () use ($placeOk, $budget) {
  reset_db(); $budget(1000, 2); $sent = 0; LfHttp::$transport = function () use (&$sent, $placeOk) { $sent++; return $placeOk($sent); };
  lf_text_search('KEY', ['textQuery' => 'x']); lf_text_search('KEY', ['textQuery' => 'x']);
  throws(fn() => lf_text_search('KEY', ['textQuery' => 'x']), '/Daily Google Places limit reached/'); eq($sent, 2);
});
test('failed requests also count, so the cap errs on the safe side', function () use ($budget) {
  reset_db(); $budget(5, 5); LfHttp::$transport = fn() => resp(403, ['error' => ['message' => 'bad key']]);
  throws(fn() => lf_text_search('KEY', ['textQuery' => 'x']), '/bad key/'); eq(lf_budget_status()['used'], 1);
});
test('other free services are never blocked by the Places limit', function () use ($budget) {
  reset_db(); $budget(0, 0); LfHttp::$transport = fn() => resp(200, []);
  eq(LfHttp::fetch('https://rdap.example/x', ['api' => 'rdap'])['status'], 200);
});
test('discovery refuses to start at the limit, and stops mid-search keeping what was found', function () use ($placeOk, $budget) {
  reset_db(); settings_for_tests(); $budget(0, 10);
  throws(fn() => lf_start_discovery(['city' => 'Dubai', 'industryId' => 'interior-design', 'count' => 5]), '/free-tier limit reached.*No requests were made/');
  $budget(2, 10); $sent = 0; LfHttp::$transport = function ($u) use (&$sent, $placeOk) { if (str_contains($u, 'places.googleapis.com')) { $sent++; return $placeOk($sent); } return resp(404, ''); };
  $job = lf_start_discovery(['city' => 'Dubai', 'industryId' => 'interior-design', 'count' => 50]); run_jobs();
  $done = lf_job_get($job['id']); eq($done['status'], 'done'); match_('/Monthly Google Places limit reached/', $done['note'] ?? '');
  eq($sent, 2, 'exactly the allowed number of requests'); eq(count(lf_companies_all()), 40, 'companies from the 2 allowed pages were still processed');
});
test('limits can be switched off deliberately', function () use ($placeOk, $budget) {
  reset_db(); $budget(0, 0, false); LfHttp::$transport = fn() => $placeOk(1);
  lf_text_search('KEY', ['textQuery' => 'x']); eq(lf_budget_status()['remaining'], null);
});
test('the owner’s chosen limits (900 a month, 50 a day) are the defaults', function () { $b = lf_defaults()['budget']; eq([$b['enabled'], $b['placesMonthlyLimit'], $b['placesDailyLimit']], [true, 900, 50]); });
