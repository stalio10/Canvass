<?php
/* Lead Finder · personalised pitches from verified findings only. No invented statistics, no guarantees, never sent automatically. */
declare(strict_types=1);

const LF_BENEFITS = [
  'website' => 'make it easier for visitors to trust you and send an enquiry, especially from their phones',
  'search' => 'help more nearby customers find you on Google Search and Google Maps',
  'creative' => 'present your work and products more clearly and consistently',
  'marketing' => 'reach new customers with campaigns you can measure',
  'other' => 'support your growth online',
];

function lf_pick_findings(array $c, int $n = 4): array {
  $issues = $c['issues'] ?? [];
  return array_slice(array_merge(array_values(array_filter($issues, fn($i) => $i['status'] === LF_CONFIRMED)), array_values(array_filter($issues, fn($i) => $i['status'] !== LF_CONFIRMED))), 0, $n);
}

function lf_generate_pitches(array $c, array $settings): ?array {
  if (($c['validation']['category'] ?? '') !== 'Qualified') return null;
  $co = $settings['company'];
  $name = $c['name']; $industry = ($c['industryName'] ?? '') ?: (($c['industry'] ?? '') ?: 'your industry'); $ind = mb_strtolower($industry);
  $findings = lf_pick_findings($c); if (!$findings) return null;
  $services = array_slice($c['services'] ?? [], 0, 4);
  $groups = array_values(array_unique(array_map(fn($s) => $s['group'], $services)));
  $benefits = array_map(fn($g) => LF_BENEFITS[$g] ?? LF_BENEFITS['other'], $groups);
  $date = substr(($c['lastVerifiedAt'] ?? '') ?: lf_now_iso(), 0, 10);
  $site = !empty($c['contact']['website']) ? (($c['website']['domain'] ?? '') ?: $c['contact']['website']) : '';
  $lines = array_map(fn($f) => '• ' . $f['title'] . (!empty($f['detail']) ? ' — ' . $f['detail'] : '') . ($f['status'] === LF_POTENTIAL ? ' (opportunity to review)' : ''), $findings);
  $svc = array_map(fn($s) => $s['name'], $services);
  $sender = ($co['sender'] ?? '') ?: $co['name'];
  $signature = implode("\n", array_values(array_unique(array_filter([$sender, $co['name'], $co['phone'] ?? '', $co['email'] ?? '', $co['website'] ?? ''], 'strlen'))));
  $intro = "I'm reaching out from {$co['name']}, a website development, branding and digital marketing company.";
  $scope = "These observations come from a review of publicly available information on $date. Some items are opportunities to discuss rather than confirmed problems.";
  $inCity = !empty($c['city']) ? ' in ' . $c['city'] : '';
  $lc = fn($s) => mb_strtolower($s);

  $email = "Subject: A few digital improvements for $name\n\nHello $name team,\n\n$intro While looking at {$ind} businesses$inCity, we reviewed " . ($site ? "your website ($site) and " : '') . "your online presence and noticed:\n\n"
    . implode("\n", $lines) . "\n\n" . ($svc ? 'We help businesses like yours with ' . implode(', ', $svc) . '. ' : '') . 'Addressing these could ' . implode(', and ', $benefits) . ".\n\n$scope\n\n"
    . "Would you be open to a 15-minute call this week? We can walk you through the findings at no cost.\n\nBest regards,\n$signature\n\nIf you'd prefer not to hear from us, reply \"unsubscribe\" and we won't contact you again.";

  $whatsapp = "Hello $name 👋 This is $sender from {$co['name']}. We reviewed your online presence on $date and noticed " . implode(' and ', array_map(fn($f) => $lc($f['title']), array_slice($findings, 0, 2))) . '. '
    . ($svc ? 'We help with ' . implode(' and ', array_slice($svc, 0, 2)) . '. ' : '') . "Could we share a short free summary of what we found? Reply STOP if you'd rather not hear from us.";

  $call = "CALL SCRIPT — $name\n1. Introduction: \"Hello, this is " . (($co['sender'] ?? '') ?: '[your name]') . " from {$co['name']}. Is this a good time for two minutes?\"\n"
    . "2. Reason for calling: \"We help {$ind} businesses$inCity with their websites and online presence. We looked at yours and noted a few things.\"\n"
    . "3. Findings (mention one or two):\n" . implode("\n", array_map(fn($f) => '   - ' . $f['title'] . (!empty($f['detail']) ? ': ' . $f['detail'] : ''), array_slice($findings, 0, 3))) . "\n"
    . '4. Question: "Is improving ' . (in_array('search', $groups, true) ? 'how customers find you online' : 'your website enquiries') . " something you're working on at the moment?\"\n"
    . '5. Offer: "We can send a free written audit and discuss ' . (implode(' or ', array_slice($svc, 0, 2)) ?: 'next steps') . ".\"\n"
    . "6. Close: \"Would a short call later this week work? What's the best email to send the audit to?\"\nNote: These are observations from public information, not guarantees of results. Respect a \"no\" and record it.";

  $svcLines = implode("\n", array_map(fn($s) => '• ' . $s['name'] . ' — addresses: ' . implode('; ', $s['reasons']), $services)) ?: '• To be agreed after discovery call';
  $proposal = "BUSINESS PROPOSAL (DRAFT) — $name\nPrepared by {$co['name']} · $date\n\n1. About $name\n$industry" . (!empty($c['city']) ? ', ' . $c['city'] : '') . (!empty($c['country']) ? ', ' . $c['country'] : '') . ($site ? ' · ' . $site : '')
    . "\n\n2. What we found\n" . implode("\n", $lines) . "\n\n3. Recommended services\n$svcLines\n\n4. Expected benefits\n" . implode("\n", array_map(fn($b) => '• ' . mb_strtoupper(mb_substr($b, 0, 1)) . mb_substr($b, 1), $benefits))
    . "\n\n5. Next steps\n• Discovery call to confirm goals and priorities\n• Written scope, timeline and pricing (to be agreed after discovery)\n\nResults depend on many factors; no rankings, traffic or revenue outcomes are guaranteed.\n$scope";

  $auditOffer = "Subject: Free digital audit for $name\n\nHello $name team,\n\n{$co['name']} is offering a complimentary digital audit to selected {$ind} businesses$inCity. Our first look already found " . count($findings) . ' item(s) worth reviewing, including ' . $lc($findings[0]['title']) . ".\n\n"
    . "The full audit covers your website, Google Business Profile, customer reviews and local search presence, with a short list of practical priorities. There is no cost or obligation.\n\nWould you like us to prepare it? Just reply to this email.\n\nBest regards,\n$signature\n\nReply \"unsubscribe\" to stop further messages.";

  return ['email' => $email, 'whatsapp' => $whatsapp, 'call' => $call, 'proposal' => $proposal, 'auditOffer' => $auditOffer, 'generatedAt' => lf_now_iso(), 'basedOn' => array_map(fn($f) => $f['id'], $findings)];
}
