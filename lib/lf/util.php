<?php
/* Lead Finder · shared helpers: safe outbound HTTP (retries, throttling, SSRF guard, free-tier guard), usage tracking, normalisation.
 * Port of server/lib/util.js (v1.0). Every network call goes through LfHttp::fetch so limits and counters always apply. */
declare(strict_types=1);

class ApiError extends RuntimeException {
  public int $status; public string $api; public bool $retryable; public string $errCode;
  public function __construct(string $message, array $o = []) {
    parent::__construct($message);
    $this->status = (int) ($o['status'] ?? 0); $this->api = (string) ($o['api'] ?? ''); $this->retryable = (bool) ($o['retryable'] ?? false); $this->errCode = (string) ($o['code'] ?? '');
  }
}

function lf_now_iso(?float $t = null): string { $t = $t ?? microtime(true); return gmdate('Y-m-d\TH:i:s', (int) floor($t)) . sprintf('.%03dZ', (int) (($t - floor($t)) * 1000)); }
function lf_new_id(string $prefix = 'cmp'): string { return $prefix . '_' . bin2hex(random_bytes(6)); }
function lf_ts($iso): ?float { if (!is_string($iso) || $iso === '') return null; try { return (float) (new DateTimeImmutable($iso))->format('U.u'); } catch (Throwable $e) { return null; } }
function lf_valid_date($s): bool { return lf_ts($s) !== null; }
function lf_years_between(string $from, ?float $to = null): float { return (($to ?? microtime(true)) - lf_ts($from)) / (365.2425 * 86400); }
function lf_months_between(string $from, ?float $to = null): float { return (($to ?? microtime(true)) - lf_ts($from)) / (30.436875 * 86400); }
function lf_iso_date(?float $t = null): string { return gmdate('Y-m-d', (int) ($t ?? time())); }
/** JS-style truthiness for values coming from JSON. */
function lf_truthy($v): bool { return !($v === null || $v === false || $v === '' || $v === 0 || $v === 0.0 || (is_float($v) && is_nan($v))); }
function lf_get($arr, string $path, $default = null) {
  $cur = $arr;
  foreach (explode('.', $path) as $k) { if (is_array($cur) && array_key_exists($k, $cur)) $cur = $cur[$k]; else return $default; }
  return $cur ?? $default;
}
function lf_slice_str(string $s, int $n): string { return mb_substr($s, 0, $n); }

/* ---------------- HTTP ---------------- */
final class LfHttp {
  /** @var callable|null (string $api): void — throws ApiError(code BUDGET) to stop a billable call before it is sent */
  public static $budgetGuard = null;
  /** @var callable|null (string $api, bool $ok): void */
  public static $usageSink = null;
  /** @var callable|null test transport: (string $url, array $opts): array{status:int,headers:array,body:string} */
  public static $transport = null;
  public static bool $sleep = true;
  private static array $last = [];
  const GAP_MS = ['places' => 250, 'pagespeed' => 1200, 'rdap' => 600, 'wayback' => 800, 'website' => 0];

  public static function record(string $api, bool $ok): void { try { if (self::$usageSink) (self::$usageSink)($api, $ok); } catch (Throwable $e) {} }
  public static function pause(int $ms): void { if (self::$sleep && $ms > 0) usleep($ms * 1000); }
  private static function throttle(string $api): void {
    $gap = self::GAP_MS[$api] ?? 0; if (!$gap) return;
    $nowMs = microtime(true) * 1000; $prev = self::$last[$api] ?? 0; $wait = $prev + $gap - $nowMs;
    self::$last[$api] = max($nowMs, $prev + $gap);
    if ($wait > 0) self::pause((int) $wait);
  }
  public static function usingProxy(): bool { foreach (['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as $k) if (getenv($k)) return true; return false; }

  /**
   * opts: api, timeout (s), retries, guard (SSRF check every hop), maxRedirects, method, headers [k=>v], body, maxBytes
   * returns: status, headers (lowercase keys), body, finalUrl, elapsedMs, redirects[]
   */
  public static function fetch(string $url, array $o = []): array {
    $api = $o['api'] ?? 'website'; $retries = $o['retries'] ?? 2; $guard = !empty($o['guard']); $maxRedirects = $o['maxRedirects'] ?? 5;
    $attempt = 0;
    for (;;) {
      if (self::$budgetGuard) (self::$budgetGuard)($api);       // throws BUDGET: nothing is sent or counted
      self::throttle($api);
      $started = microtime(true);
      try {
        $target = $url; $redirects = [];
        for ($hop = 0; ; $hop++) {
          $pin = $guard ? lf_assert_public_url($target) : null;
          $res = self::send($target, $o, $guard, $pin);
          $loc = $res['headers']['location'] ?? '';
          if ($guard && $res['status'] >= 300 && $res['status'] < 400 && $loc !== '' && $hop < $maxRedirects) {
            $next = lf_resolve_url($loc, $target); $redirects[] = ['from' => $target, 'to' => $next, 'status' => $res['status']]; $target = $next; continue;
          }
          break;
        }
        $elapsed = (int) round((microtime(true) - $started) * 1000);
        if (($res['status'] === 429 || $res['status'] >= 500) && $attempt < $retries) {
          $attempt++; self::record($api, false);
          $ra = (int) ($res['headers']['retry-after'] ?? 0) * 1000;
          self::pause($ra > 0 ? min($ra, 30000) : 1000 * (2 ** $attempt)); continue;
        }
        self::record($api, $res['status'] >= 200 && $res['status'] < 300);
        $res['finalUrl'] = $res['finalUrl'] ?? $target; $res['elapsedMs'] = $elapsed; $res['redirects'] = $redirects;
        $res['ok'] = $res['status'] >= 200 && $res['status'] < 300;
        return $res;
      } catch (ApiError $e) {
        self::record($api, false);
        if ($e->errCode === 'NET' && $attempt < $retries) { $attempt++; self::pause(1000 * (2 ** $attempt)); continue; }
        if ($e->errCode === 'NET') throw new ApiError($e->getMessage(), ['api' => $api, 'retryable' => true]);
        throw $e;
      }
    }
  }

  private static function send(string $url, array $o, bool $guard, ?array $pin): array {
    $headers = array_merge(['user-agent' => 'CanvassLeadFinder/2.0 (+business website audit)'], $o['headers'] ?? []);
    $method = strtoupper($o['method'] ?? 'GET');
    if (self::$transport) {
      $r = (self::$transport)($url, ['method' => $method, 'headers' => $headers, 'body' => $o['body'] ?? null, 'follow' => !$guard]);
      if (isset($r['error'])) throw new ApiError($r['error'], ['code' => 'NET']);
      $r['headers'] = array_change_key_case($r['headers'] ?? [], CASE_LOWER);
      $r['body'] = (string) ($r['body'] ?? ''); $r['status'] = (int) $r['status'];
      $max = $o['maxBytes'] ?? 2500000; if (strlen($r['body']) > $max) $r['body'] = substr($r['body'], 0, $max);
      return $r;
    }
    $ch = curl_init($url); $respHeaders = []; $body = ''; $max = $o['maxBytes'] ?? 2500000;
    $hl = []; foreach ($headers as $k => $v) $hl[] = $k . ': ' . $v;
    $opts = [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $hl, CURLOPT_TIMEOUT => (int) ($o['timeout'] ?? 20), CURLOPT_CONNECTTIMEOUT => 10,
      CURLOPT_FOLLOWLOCATION => !$guard, CURLOPT_MAXREDIRS => 5, CURLOPT_ENCODING => '', CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
      CURLOPT_HEADERFUNCTION => function ($c, $line) use (&$respHeaders) { $p = strpos($line, ':'); if ($p !== false) $respHeaders[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1)); elseif (preg_match('#^HTTP/#', $line)) $respHeaders = []; return strlen($line); },
      CURLOPT_WRITEFUNCTION => function ($c, $chunk) use (&$body, $max) { $body .= $chunk; return strlen($body) > $max ? 0 : strlen($chunk); }];
    if (defined('CURLOPT_REDIR_PROTOCOLS')) $opts[CURLOPT_REDIR_PROTOCOLS] = CURLPROTO_HTTP | CURLPROTO_HTTPS;
    if ($method === 'HEAD') $opts[CURLOPT_NOBODY] = true;
    if (isset($o['body'])) $opts[CURLOPT_POSTFIELDS] = $o['body'];
    if ($ca = getenv('CANVASS_CA_BUNDLE')) $opts[CURLOPT_CAINFO] = $ca;
    if ($pin && !self::usingProxy()) $opts[CURLOPT_RESOLVE] = [$pin['host'] . ':' . $pin['port'] . ':' . $pin['ip']]; // connect only to the address we checked
    curl_setopt_array($ch, $opts);
    $ok = curl_exec($ch); $errno = curl_errno($ch); $err = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $final = (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
    curl_close($ch);
    if ($ok === false && !($errno === 23 && $status > 0)) {           // 23 = we stopped reading at the size limit: keep what we have
      $kind = $errno === 28 ? 'Timed out' : 'Network error';
      throw new ApiError($kind . ' contacting ' . (parse_url($url, PHP_URL_HOST) ?: 'remote host') . ': ' . $err, ['code' => 'NET']);
    }
    return ['status' => $status, 'headers' => $respHeaders, 'body' => $body, 'finalUrl' => $final ?: $url];
  }
}

function lf_resolve_url(string $rel, string $base): string {
  if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $rel)) return $rel;
  $b = parse_url($base); if (!$b || empty($b['host'])) return $rel;
  $origin = ($b['scheme'] ?? 'http') . '://' . $b['host'] . (isset($b['port']) ? ':' . $b['port'] : '');
  if (str_starts_with($rel, '//')) return ($b['scheme'] ?? 'http') . ':' . $rel;
  if (str_starts_with($rel, '#')) return preg_replace('/#.*$/', '', $base) . $rel;
  if (str_starts_with($rel, '?')) return $origin . ($b['path'] ?? '/') . $rel;
  if (str_starts_with($rel, '/')) $path = $rel;
  else { $dir = preg_replace('#/[^/]*$#', '/', $b['path'] ?? '/'); $path = $dir . $rel; }
  // normalise ./ and ../
  [$p, $rest] = array_pad(preg_split('/(?=[?#])/', $path, 2), 2, '');
  $out = [];
  foreach (explode('/', $p) as $i => $seg) { if ($seg === '..') { if (count($out) > 1) array_pop($out); } elseif ($seg !== '.') $out[] = $seg; }
  $np = implode('/', $out); if ($np === '' || $np[0] !== '/') $np = '/' . ltrim($np, '/');
  if (preg_match('#/\.\.?$#', $p)) $np = rtrim($np, '/') . '/';
  return $origin . $np . $rest;
}

/* ---------------- SSRF guard: only public internet hosts ---------------- */
function lf_is_private_ip(string $ip): bool {
  if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
    [$a, $b] = array_map('intval', explode('.', $ip));
    return $a === 10 || $a === 127 || $a === 0 || ($a === 169 && $b === 254) || ($a === 172 && $b >= 16 && $b <= 31) || ($a === 192 && $b === 168) || ($a === 100 && $b >= 64 && $b <= 127) || $a >= 224;
  }
  $v = strtolower($ip);
  if (str_starts_with($v, '::ffff:')) return lf_is_private_ip(substr($v, 7));
  return $v === '::1' || $v === '::' || str_starts_with($v, 'fc') || str_starts_with($v, 'fd') || str_starts_with($v, 'fe80');
}
/** Throws for anything that is not a public http(s) URL. Returns the checked address so the connection can be pinned to it. */
function lf_assert_public_url(string $raw): ?array {
  $u = parse_url($raw);
  if (!$u || empty($u['scheme'])) throw new ApiError('Invalid URL: ' . $raw);
  if (!in_array(strtolower($u['scheme']), ['http', 'https'], true)) throw new ApiError('Only http(s) URLs are allowed');
  if (isset($u['user']) || isset($u['pass'])) throw new ApiError('URLs with credentials are not allowed');
  $host = trim($u['host'] ?? '', '[]');
  if ($host === '') throw new ApiError('Invalid URL: ' . $raw);
  if (preg_match('/^(localhost|.*\.local|.*\.internal)$/i', $host)) throw new ApiError('Private host not allowed');
  $port = (int) ($u['port'] ?? (strtolower($u['scheme']) === 'https' ? 443 : 80));
  if (filter_var($host, FILTER_VALIDATE_IP)) $addrs = [$host];
  else {
    $addrs = LfHttp::$transport ? [] : (@gethostbynamel($host) ?: []);
    if (!LfHttp::$transport) foreach (@dns_get_record($host, DNS_AAAA) ?: [] as $r) if (!empty($r['ipv6'])) $addrs[] = $r['ipv6'];
    if (!$addrs) {
      if (LfHttp::usingProxy() || LfHttp::$transport) return null;   // behind a proxy the proxy resolves names; hostname rules above still apply
      throw new ApiError('Domain does not resolve: ' . $host, ['api' => 'website', 'code' => 'DNS']);
    }
  }
  foreach ($addrs as $a) if (lf_is_private_ip($a)) throw new ApiError('Private network address not allowed');
  return ['host' => $host, 'port' => $port, 'ip' => str_contains($addrs[0], ':') ? '[' . $addrs[0] . ']' : $addrs[0]];
}

/** Is this server online? So our own connection problems are never reported as a business's website problem. */
function lf_internet_ok(): bool {
  static $cache = null;
  if ($cache && microtime(true) - $cache[0] < 60) return $cache[1];
  $ok = false;
  foreach (['https://www.google.com/generate_204', 'https://www.cloudflare.com/cdn-cgi/trace'] as $u) {
    try { $r = LfHttp::fetch($u, ['api' => 'net', 'timeout' => 8, 'retries' => 0]); if ($r['status'] < 500 && $r['status'] > 0) { $ok = true; break; } } catch (Throwable $e) {}
  }
  $cache = [microtime(true), $ok];
  return $ok;
}

/* ---------------- normalisation for duplicate detection ---------------- */
function lf_normalize_url($raw): string {
  $s = trim((string) $raw); if ($s === '') return '';
  if (!preg_match('#^https?://#i', $s)) $s = 'https://' . $s;
  $u = parse_url($s); if (!$u || empty($u['host']) || !str_contains($u['host'], '.') || preg_match('/\s/', $s)) return '';
  $host = strtolower($u['host']);
  return strtolower($u['scheme']) . '://' . $host . (isset($u['port']) ? ':' . $u['port'] : '') . ($u['path'] ?? '/') . (isset($u['query']) ? '?' . $u['query'] : '') . (isset($u['fragment']) ? '#' . $u['fragment'] : '');
}
function lf_domain_of($raw): string { $u = lf_normalize_url($raw); if ($u === '') return ''; return preg_replace('/^www\./', '', strtolower((string) parse_url($u, PHP_URL_HOST))); }
function lf_is_social_url($raw): bool { $d = lf_domain_of($raw); return $d !== '' && (bool) preg_match('/(^|\.)(facebook|instagram|linkedin|tiktok|twitter|x|youtube|wa|whatsapp|google|goo|linktr|bit)\.(com|ee|me|gl|ly)$/i', $d); }
function lf_registrable_domain($host): string {
  $parts = array_values(array_filter(explode('.', strtolower((string) $host)), 'strlen'));
  $n = count($parts); if ($n <= 2) return implode('.', $parts);
  $sld = $parts[$n - 2];
  if (in_array($sld, ['co', 'com', 'net', 'org', 'gov', 'ac', 'edu', 'sch', 'ltd'], true) && strlen($parts[$n - 1]) === 2) return implode('.', array_slice($parts, -3));
  return implode('.', array_slice($parts, -2));
}
function lf_norm_name($s): string {
  $s = mb_strtolower((string) $s);
  $s = str_replace('&', ' and ', $s);
  $s = preg_replace('/\b(llc|l\.l\.c|fze|fzco|fz llc|fzc|est|establishment|trading|co|company|ltd|limited|inc|plc|pvt|llp|dmcc|sole proprietorship)\b\.?/u', ' ', $s);
  $s = preg_replace('/[^a-z0-9\x{0600}-\x{06FF}]+/u', ' ', $s);
  return preg_replace('/\s+/', ' ', trim($s));
}
function lf_norm_phone($s): string { $d = preg_replace('/\D/', '', (string) $s); return strlen($d) >= 7 ? substr($d, -9) : ''; }
function lf_norm_place($s): string { return trim(preg_replace('/[^a-z0-9]+/', ' ', strtolower((string) $s))); }
function lf_name_similarity($a, $b): float {
  $A = array_unique(array_filter(explode(' ', lf_norm_name($a)), 'strlen')); $B = array_unique(array_filter(explode(' ', lf_norm_name($b)), 'strlen'));
  if (!$A || !$B) return 0.0;
  return count(array_intersect($A, $B)) / max(count($A), count($B));
}
