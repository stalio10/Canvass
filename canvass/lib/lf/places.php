<?php
/* Lead Finder · Google Places API (New) client. Authorised API only — no scraping of Google Maps pages. */
declare(strict_types=1);

const LF_PLACES_BASE = 'https://places.googleapis.com/v1';
const LF_PLACE_FIELDS = ['id', 'displayName', 'formattedAddress', 'addressComponents', 'location', 'googleMapsUri', 'websiteUri',
  'nationalPhoneNumber', 'internationalPhoneNumber', 'businessStatus', 'regularOpeningHours', 'rating', 'userRatingCount',
  'reviews', 'photos', 'primaryType', 'primaryTypeDisplayName', 'types', 'editorialSummary'];

function lf_places_parse(array $res): array {
  $data = json_decode($res['body'], true); if (!is_array($data)) $data = [];
  if (!$res['ok']) {
    $msg = $data['error']['message'] ?? ('HTTP ' . $res['status']);
    $hint = $res['status'] === 403 ? ' (check that Places API (New) is enabled and the key allows it)' : ($res['status'] === 429 ? ' (quota exceeded — try later or raise the quota)' : '');
    throw new ApiError('Google Places: ' . $msg . $hint, ['status' => $res['status'], 'api' => 'places', 'retryable' => $res['status'] === 429 || $res['status'] >= 500]);
  }
  return $data;
}

/** One page of Text Search (max 20 results). */
function lf_text_search(string $key, array $q): array {
  if ($key === '') throw new ApiError('Google Places API key is not configured (Lead Finder → Settings → API keys).', ['api' => 'places']);
  $body = ['textQuery' => $q['textQuery'], 'pageSize' => min(20, $q['pageSize'] ?? 20), 'languageCode' => $q['languageCode'] ?? 'en'];
  if (!empty($q['regionCode'])) $body['regionCode'] = $q['regionCode'];
  if (!empty($q['pageToken'])) $body['pageToken'] = $q['pageToken'];
  $res = LfHttp::fetch(LF_PLACES_BASE . '/places:searchText', ['api' => 'places', 'method' => 'POST', 'timeout' => 30,
    'headers' => ['content-type' => 'application/json', 'X-Goog-Api-Key' => $key, 'X-Goog-FieldMask' => 'nextPageToken,' . implode(',', array_map(fn($f) => 'places.' . $f, LF_PLACE_FIELDS))],
    'body' => json_encode($body)]);
  $d = lf_places_parse($res);
  return ['places' => $d['places'] ?? [], 'nextPageToken' => $d['nextPageToken'] ?? ''];
}

function lf_place_details(string $key, string $placeId): array {
  if ($key === '') throw new ApiError('Google Places API key is not configured (Lead Finder → Settings → API keys).', ['api' => 'places']);
  if (!preg_match('/^[A-Za-z0-9_-]{10,}$/', $placeId)) throw new ApiError('Invalid Google Place ID');
  $res = LfHttp::fetch(LF_PLACES_BASE . '/places/' . rawurlencode($placeId), ['api' => 'places', 'timeout' => 30, 'headers' => ['X-Goog-Api-Key' => $key, 'X-Goog-FieldMask' => implode(',', LF_PLACE_FIELDS)]]);
  return lf_places_parse($res);
}

/** Flatten a Places API result into the record's `google` block (with fetch timestamp for retention). */
function lf_google_block(array $p): array {
  $photos = is_array($p['photos'] ?? null) ? $p['photos'] : [];
  $attr = [];
  foreach (array_slice($photos, 0, 3) as $ph) foreach ($ph['authorAttributions'] ?? [] as $a) if (!empty($a['displayName'])) $attr[] = $a['displayName'];
  return [
    'placeId' => $p['id'] ?? '', 'fetchedAt' => lf_now_iso(), 'source' => 'Google Places API (New)',
    'displayName' => $p['displayName']['text'] ?? '', 'formattedAddress' => $p['formattedAddress'] ?? '', 'addressComponents' => $p['addressComponents'] ?? [],
    'location' => $p['location'] ?? null, 'googleMapsUri' => $p['googleMapsUri'] ?? '', 'websiteUri' => $p['websiteUri'] ?? '',
    'nationalPhoneNumber' => $p['nationalPhoneNumber'] ?? '', 'internationalPhoneNumber' => $p['internationalPhoneNumber'] ?? '',
    'businessStatus' => $p['businessStatus'] ?? '', 'regularOpeningHours' => isset($p['regularOpeningHours']) ? ['weekdayDescriptions' => $p['regularOpeningHours']['weekdayDescriptions'] ?? []] : null,
    'rating' => is_numeric($p['rating'] ?? null) ? $p['rating'] + 0 : null, 'userRatingCount' => is_numeric($p['userRatingCount'] ?? null) ? (int) $p['userRatingCount'] : null,
    'reviews' => array_map(fn($r) => ['rating' => $r['rating'] ?? null, 'text' => $r['text']['text'] ?? ($r['originalText']['text'] ?? ''), 'publishTime' => $r['publishTime'] ?? '',
      'relativeTime' => $r['relativePublishTimeDescription'] ?? '', 'author' => $r['authorAttribution']['displayName'] ?? '', 'authorUri' => $r['authorAttribution']['uri'] ?? ''], $p['reviews'] ?? []),
    'photoCount' => count($photos), 'photoAttributions' => $attr,
    'primaryType' => $p['primaryType'] ?? '', 'primaryTypeDisplayName' => $p['primaryTypeDisplayName']['text'] ?? '', 'types' => $p['types'] ?? [],
    'editorialSummary' => $p['editorialSummary']['text'] ?? '',
  ];
}

/** Pull a usable reference out of a pasted Google Maps link (place ID, name, coordinates). */
function lf_parse_maps_link(string $link): array {
  $out = []; $u = parse_url($link); if (!$u || empty($u['host'])) return $out;
  parse_str($u['query'] ?? '', $q);
  if (!empty($q['query_place_id'])) $out['placeId'] = $q['query_place_id'];
  if (!empty($q['place_id'])) $out['placeId'] = $q['place_id'];
  if (!empty($q['cid'])) $out['cid'] = $q['cid'];
  $path = $u['path'] ?? '';
  if (preg_match('#/maps/place/([^/]+)#', $path, $m)) $out['name'] = urldecode(str_replace('+', ' ', $m[1]));
  if (empty($out['name']) && !empty($q['query'])) $out['name'] = $q['query'];
  if (empty($out['name']) && !empty($q['q'])) $out['name'] = $q['q'];
  if (preg_match('#@(-?\d+\.\d+),(-?\d+\.\d+)#', $path, $m)) $out['coords'] = ['lat' => (float) $m[1], 'lng' => (float) $m[2]];
  return $out;
}
function lf_is_maps_link($s): bool { return (bool) preg_match('#^(https?://)?((www\.)?google\.[a-z.]+/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl/maps)#i', trim((string) $s)); }
