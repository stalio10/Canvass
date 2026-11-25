<?php
/* Lead Finder · validation categories, 100-point lead score, service recommendations. Pure functions — fully unit-tested. */
declare(strict_types=1);

const LF_CATEGORIES = ['Qualified', 'Unverified', 'Rejected', 'No Opportunity'];

/** Mandatory rules decide the category; the score never overrides them. Order: Rejected > Unverified > No Opportunity > Qualified. */
function lf_validate(array $c, array $settings): array {
  $checks = [];
  $rule = function ($id, $label, $state, $detail = '') use (&$checks) { $checks[] = ['id' => $id, 'label' => $label, 'state' => $state, 'detail' => (string) $detail]; };
  $act = $c['activity'] ?? []; $age = $c['age'] ?? []; $ind = $c['industryCheck'] ?? []; $loc = $c['locationCheck'] ?? []; $size = $c['sizeCheck'] ?? [];
  if (!empty($c['duplicateOf'])) $rule('duplicate', 'Not a duplicate', 'fail-reject', 'Duplicate of ' . $c['duplicateOf']); else $rule('duplicate', 'Not a duplicate', 'pass');
  $as = $act['status'] ?? '';
  if ($as === 'Closed permanently' || $as === 'Closed temporarily') $rule('operational', 'Currently operating', 'fail-reject', $as);
  elseif ($as === 'Verified') $rule('operational', 'Currently operating', 'pass', ($act['signals'] ?? 0) . ' activity signals');
  else $rule('operational', 'Currently operating', 'fail-unverified', ($act['note'] ?? '') ?: 'Not enough evidence of current activity');
  if (!empty($c['invalid'])) $rule('genuine', 'Genuine business', 'fail-reject', $c['invalid']);
  elseif (!empty($c['google']['placeId']) || !empty($c['manualIdentity'])) $rule('genuine', 'Genuine business', 'pass', !empty($c['google']['placeId']) ? 'Listed on Google Business' : 'Verified by team');
  elseif (!empty($c['websiteAudit']['availability']['ok'])) $rule('genuine', 'Genuine business', 'fail-unverified', 'Working website, but no business listing or registration evidence');
  else $rule('genuine', 'Genuine business', 'fail-unverified', 'No business listing, registration or working website found');
  $is = $ind['status'] ?? '';
  if ($is === 'Irrelevant') $rule('industry', 'Relevant industry', 'fail-reject', $ind['note'] ?? '');
  elseif ($is === 'Uncertain') $rule('industry', 'Relevant industry', 'fail-unverified', $ind['note'] ?? '');
  else $rule('industry', 'Relevant industry', $is === 'Relevant' ? 'pass' : 'n/a', ($ind['by'] ?? '') ?: ($ind['note'] ?? ''));
  $ls = $loc['status'] ?? '';
  if ($ls === 'Out of location') $rule('location', 'Within selected location', 'fail-reject', $loc['note'] ?? '');
  elseif ($ls === 'Unknown') $rule('location', 'Within selected location', 'fail-unverified', $loc['note'] ?? '');
  else $rule('location', 'Within selected location', $ls === 'Matching' ? 'pass' : 'n/a', $loc['note'] ?? '');
  if (($size['status'] ?? '') === 'Large') $rule('size', 'Small or growing business', 'fail-reject', $size['note'] ?? ''); else $rule('size', 'Small or growing business', 'pass');
  $yrs = $settings['eligibilityYears']; $w = $age['withinWindow'] ?? null; $notes = $age['notes'] ?? [];
  if ($w === false) $rule('age', "Established within $yrs years", 'fail-reject', ($notes[0] ?? '') ?: 'Older than the eligibility window');
  elseif ($w === true) $rule('age', "Established within $yrs years", 'pass', ($age['status'] ?? '') . ': ' . ($age['basis'] ?? ''));
  else $rule('age', "Established within $yrs years", 'fail-unverified', ($notes ? end($notes) : '') ?: 'Age not verified');
  $ct = $c['contact'] ?? [];
  $hasContact = !empty($ct['phone']) || !empty($ct['email']) || !empty($ct['website']);
  $rule('contact', 'Public contact information', $hasContact ? 'pass' : 'fail-unverified', $hasContact ? '' : 'No public phone, email or website found');
  $issues = $c['issues'] ?? [];
  $confirmed = count(array_filter($issues, fn($i) => ($i['status'] ?? '') === LF_CONFIRMED)); $potential = count($issues) - $confirmed;
  $hasOpp = !empty($settings['requireConfirmedIssue']) ? $confirmed > 0 : count($issues) > 0;
  $rule('opportunity', 'Digital improvement opportunity', $hasOpp ? 'pass' : 'no-opportunity', "$confirmed confirmed, $potential potential");
  $rej = array_filter($checks, fn($x) => $x['state'] === 'fail-reject'); $unv = array_filter($checks, fn($x) => $x['state'] === 'fail-unverified');
  $category = $rej ? 'Rejected' : ($unv ? 'Unverified' : (!$hasOpp ? 'No Opportunity' : 'Qualified'));
  $src = $category === 'Rejected' ? $rej : ($category === 'Unverified' ? $unv : ($category === 'No Opportunity' ? array_filter($checks, fn($x) => $x['state'] === 'no-opportunity') : []));
  $reasons = array_values(array_map(fn($x) => $x['label'] . ': ' . ($x['detail'] !== '' ? $x['detail'] : 'failed'), $src));
  return ['category' => $category, 'reasons' => $reasons, 'checks' => $checks, 'validatedAt' => lf_now_iso()];
}

/** Configurable 100-point sales-opportunity score (not a measure of trustworthiness). */
function lf_score(array $c, array $settings): array {
  $w = $settings['weights']; $total = array_sum($w) ?: 1;
  $age = $c['age'] ?? [];
  $ageFrac = ($age['withinWindow'] ?? null) === true ? (($age['status'] ?? '') === 'Verified' ? ((($age['yearsOld'] ?? null) !== null && $age['yearsOld'] <= 2) ? 1 : 0.85) : 0.5) : 0;
  $act = $c['activity'] ?? []; $sig = $act['signals'] ?? 0;
  $actFrac = ($act['status'] ?? '') === 'Verified' ? min(1, 0.6 + 0.1 * $sig) : (($act['status'] ?? '') === 'Unverified' ? min(0.4, 0.1 * $sig) : 0);
  $pts = fn($list) => array_reduce($list, fn($s, $i) => $s + (($i['status'] ?? '') === LF_CONFIRMED ? 1 : 0.4), 0);
  $issues = $c['issues'] ?? [];
  $gbpFrac = min(1, $pts(array_filter($issues, fn($i) => ($i['area'] ?? '') === 'gbp')) / 5);
  $noSite = empty($c['contact']['website']) && ($c['websiteStatus'] ?? '') === 'Not found';
  $webFrac = $noSite ? 1 : min(1, $pts(array_filter($issues, fn($i) => ($i['area'] ?? '') === 'website')) / 5);
  $ct = $c['contact'] ?? [];
  $ctFrac = (!empty($ct['phone']) ? 0.4 : 0) + (!empty($ct['email']) ? 0.3 : 0) + (!empty($ct['website']) || !empty($ct['address']) ? 0.3 : 0);
  $parts = ['age' => $ageFrac * $w['age'], 'activity' => $actFrac * $w['activity'], 'gbp' => $gbpFrac * $w['gbp'], 'website' => $webFrac * $w['website'], 'contact' => $ctFrac * $w['contact']];
  foreach ($parts as $k => $v) $parts[$k] = round($v * 10) / 10;
  $value = (int) round(array_sum($parts) * 100 / $total);
  $priority = $value >= $settings['priority']['high'] ? 'High' : ($value >= $settings['priority']['medium'] ? 'Medium' : 'Low');
  return ['total' => $value, 'parts' => $parts, 'priority' => $priority, 'max' => $w, 'note' => 'Sales-opportunity score. It does not measure trustworthiness or business quality.'];
}

/** Recommend only enabled services that are tied to an actual finding. */
function lf_recommend_services(array $c, array $settings): array {
  $enabled = []; foreach ($settings['services'] as $s) if (!empty($s['enabled'])) $enabled[$s['name']] = true;
  $map = [];
  $add = function ($name, $reason) use (&$map, $enabled) { if (!isset($enabled[$name])) return; $map[$name][$reason] = true; };
  foreach ($c['issues'] ?? [] as $i) foreach ($i['services'] ?? [] as $s) $add($s, $i['title']);
  if (($c['websiteStatus'] ?? '') === 'Not found') foreach (['Website design', 'Website development', 'Branding', 'Domain and hosting support'] as $s) $add($s, 'No website found in checked sources');
  if (!empty($c['websiteAudit']['page']) && empty($c['websiteAudit']['page']['social']) && empty($c['social']['instagram'])) $add('Social media management', 'No social media profiles found');
  $group = []; foreach ($settings['services'] as $s) $group[$s['name']] = $s['group'];
  $out = []; $i = 0;
  foreach ($map as $name => $reasons) $out[] = ['name' => $name, 'group' => $group[$name] ?? 'other', 'reasons' => array_slice(array_keys($reasons), 0, 4), '_n' => count($reasons), '_i' => $i++];
  usort($out, fn($a, $b) => ($b['_n'] <=> $a['_n']) ?: ($a['_i'] <=> $b['_i']));
  return array_map(function ($x) { unset($x['_n'], $x['_i']); return $x; }, $out);
}
