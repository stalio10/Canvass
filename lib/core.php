<?php
/* Canvass · shared core: data folder, SQLite database, sign-in sessions, business helpers.
 * Used by api.php (the web API) and cron.php (background processing). Data lives OUTSIDE the web folder when the host allows it. */
declare(strict_types=1);
date_default_timezone_set('UTC');
mb_internal_encoding('UTF-8');

const APP_VERSION = '5.0';
const SESSION_DAYS = 60;
const MAX_UPLOAD = 25 * 1024 * 1024;
const NPC = 6;

/* First run only: these accounts are created when the database is empty. Change passwords in the app afterwards. */
const SEED_USERS = [
  ['MSB',    'Shibili', 'admin', 'Designer', 1],
  ['Ismail', 'Ismail',  '0000',  'Scout',    0],
  ['Amal',   'Amal',    '0000',  'Scout',    0],
  ['Tins',   'Tins',    '0000',  'Scout',    0],
];

class HttpFail extends RuntimeException { public int $http; public array $extra; public function __construct(string $m, int $code = 400, array $extra = []) { parent::__construct($m); $this->http = $code; $this->extra = $extra; } }

function dataDir(): string {
  static $dir = null; if ($dir) return $dir;
  $cands = [];
  $root = dirname(__DIR__);                                         // the web folder (where index.html and api.php live)
  if ($e = getenv('CANVASS_DATA_DIR')) $cands[] = $e;
  if (is_file("$root/config.php")) { $cfg = include "$root/config.php"; if (is_array($cfg) && !empty($cfg['dataDir'])) $cands[] = (string) $cfg['dataDir']; }   // optional, kept out of Git
  $cands[] = dirname($root, 2) . '/canvass-hq-data';                // e.g. /home/u…/domains/mhdshibili.com/canvass-hq-data (Pitch HQ's folder)
  $cands[] = $root . '/data';
  foreach ($cands as $d) {
    if (!is_dir($d)) @mkdir($d, 0700, true);
    if (is_dir($d) && is_writable($d)) {
      if (str_starts_with(realpath($d) ?: $d, realpath($root) ?: $root) && !file_exists("$d/.htaccess")) file_put_contents("$d/.htaccess", "Require all denied\nDeny from all\n");
      foreach (['files', 'backups'] as $sub) if (!is_dir("$d/$sub")) @mkdir("$d/$sub", 0700, true);
      return $dir = $d;
    }
  }
  throw new HttpFail('Server can’t write its data folder.', 500);
}
function nowMs(): int { return (int) floor(microtime(true) * 1000); }
function gid(): string { return base_convert((string) nowMs(), 10, 36) . bin2hex(random_bytes(4)); }

function db(): PDO {
  static $pdo = null; if ($pdo) return $pdo;
  $pdo = new PDO('sqlite:' . dataDir() . '/canvass.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
  $pdo->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=8000; PRAGMA foreign_keys=ON;');
  $pdo->exec("CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, name TEXT, pass_hash TEXT, pass_plain TEXT, role TEXT, is_admin INTEGER DEFAULT 0, color_idx INTEGER, focus TEXT DEFAULT '', theme TEXT DEFAULT '', active INTEGER DEFAULT 1, joined_at INTEGER, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT, expires INTEGER, created INTEGER);
    CREATE TABLE IF NOT EXISTS businesses(id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS tombstones(id TEXT PRIMARY KEY, data TEXT, deleted_at INTEGER);
    CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, name TEXT, type TEXT, size INTEGER, by_user TEXT, at INTEGER);
    CREATE TABLE IF NOT EXISTS attempts(ip TEXT, at INTEGER);
    CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS acc_entries(id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS acc_rec(id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS lf_companies(id TEXT PRIMARY KEY, data TEXT, name TEXT, category TEXT, score INTEGER, demo INTEGER DEFAULT 0, place_id TEXT, domain TEXT, cdomain TEXT, phone9 TEXT, name_norm TEXT, name_compact TEXT, dom_label TEXT, loc_norm TEXT, created_at TEXT, updated_at TEXT);
    CREATE INDEX IF NOT EXISTS lf_c_place ON lf_companies(place_id); CREATE INDEX IF NOT EXISTS lf_c_dom ON lf_companies(domain); CREATE INDEX IF NOT EXISTS lf_c_cdom ON lf_companies(cdomain);
    CREATE INDEX IF NOT EXISTS lf_c_phone ON lf_companies(phone9); CREATE INDEX IF NOT EXISTS lf_c_name ON lf_companies(name_norm); CREATE INDEX IF NOT EXISTS lf_c_comp ON lf_companies(name_compact); CREATE INDEX IF NOT EXISTS lf_c_lab ON lf_companies(dom_label);
    CREATE TABLE IF NOT EXISTS lf_jobs(id TEXT PRIMARY KEY, status TEXT, data TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS lf_kv(k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS lead_assignments(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id TEXT NOT NULL UNIQUE,
      employee_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('picked','in_progress','converted','sold_out')),
      picked_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      notes TEXT DEFAULT '',
      FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY(employee_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS lead_assignments_employee ON lead_assignments(employee_id);
    CREATE INDEX IF NOT EXISTS lead_assignments_status ON lead_assignments(status);
    CREATE TABLE IF NOT EXISTS lead_assignment_history(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id TEXT NOT NULL,
      employee_id TEXT,
      action TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT,
      created_at TEXT NOT NULL,
      performed_by TEXT NOT NULL,
       notes TEXT DEFAULT '',
      FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY(employee_id) REFERENCES users(id),
      FOREIGN KEY(performed_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS lead_assignment_history_business ON lead_assignment_history(business_id, created_at);
     CREATE INDEX IF NOT EXISTS lead_assignment_history_employee ON lead_assignment_history(employee_id, created_at);");
  $cols = array_column($pdo->query('PRAGMA table_info(sessions)')->fetchAll(), 'name');
  if (!in_array('acc_until', $cols, true)) $pdo->exec('ALTER TABLE sessions ADD COLUMN acc_until INTEGER DEFAULT 0');
  $ucols = array_column($pdo->query('PRAGMA table_info(users)')->fetchAll(), 'name');
  if (!in_array('mentions_seen', $ucols, true)) $pdo->exec('ALTER TABLE users ADD COLUMN mentions_seen INTEGER DEFAULT 0');
  if ((int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() === 0) {
    $st = $pdo->prepare('INSERT INTO users(id,username,name,pass_hash,pass_plain,role,is_admin,color_idx,joined_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
    foreach (SEED_USERS as $i => [$u, $n, $p, $r, $a]) $st->execute(['u_' . bin2hex(random_bytes(5)), $u, $n, password_hash($p, PASSWORD_DEFAULT), $p, $r, $a, $i % NPC, nowMs() + $i, nowMs()]);
  }
  return $pdo;
}
function meta_get(string $k, $default = null) { $st = db()->prepare('SELECT v FROM meta WHERE k=?'); $st->execute([$k]); $v = $st->fetchColumn(); return $v === false ? $default : $v; }
function meta_set(string $k, ?string $v): void { if ($v === null) db()->prepare('DELETE FROM meta WHERE k=?')->execute([$k]); else db()->prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v')->execute([$k, $v]); }
function bump(): void { db()->exec("INSERT INTO meta(k,v) VALUES('rev','1') ON CONFLICT(k) DO UPDATE SET v=CAST(v AS INTEGER)+1"); }
function rev(): int { return (int) (meta_get('rev', 0)); }

/* ---------- auth ---------- */
function ip(): string { return $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '?'; }
function tokenHash(): string { $t = $_COOKIE['canvass_t'] ?? ''; return $t === '' ? '' : hash('sha256', $t); }
function localTestingAccess(): bool {
  // This shortcut is strictly for a real local request. Never trust Host or
  // proxy headers alone: a public visitor can choose those headers.
  $remote = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
  if (!in_array($remote, ['127.0.0.1', '::1'], true)) return false;
  if ((string) (getenv('CANVASS_HOSTED') ?: '') === '1') return false;
  $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? ''));
  $host = preg_replace('/:\d+$/', '', $host);
  return in_array($host, ['localhost', '127.0.0.1', '[::1]', '::1'], true) && meta_get('local_testing_access', '0') === '1';
}
function me(bool $required = true): ?array {
  static $u = false;
  if ($u === false) {
    $u = null; $h = tokenHash();
    if ($h !== '') { $st = db()->prepare('SELECT u.*, s.acc_until FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND u.active=1'); $st->execute([$h, time()]); $u = $st->fetch() ?: null; }
    if (!$u && localTestingAccess()) $u = db()->query('SELECT * FROM users WHERE is_admin=1 AND active=1 ORDER BY joined_at LIMIT 1')->fetch() ?: null;
  }
  if (!$u && $required) throw new HttpFail('Signed out', 401);
  return $u;
}
function privileged(array $u): bool { return (int) $u['is_admin'] === 1 || $u['role'] === 'Designer'; }
function isAdmin(array $u): bool { return (int) $u['is_admin'] === 1; }
function pubUser(array $u): array {
  return ['id' => $u['id'], 'name' => $u['name'], 'role' => $u['role'], 'isAdmin' => (int) $u['is_admin'] === 1, 'colorIdx' => (int) $u['color_idx'], 'focus' => $u['focus'] ?? '', 'joinedAt' => (int) $u['joined_at'], 'active' => (int) $u['active'] === 1, 'mentionsSeen' => (int) ($u['mentions_seen'] ?? 0)];
}
function meOut(array $u): array { return pubUser($u) + ['username' => $u['username'], 'theme' => $u['theme'] ?? '']; }
function userName(string $id): string { $st = db()->prepare('SELECT name FROM users WHERE id=?'); $st->execute([$id]); return (string) ($st->fetchColumn() ?: 'Someone'); }

/* ---------- businesses (Pitch HQ) ---------- */
function getBiz(string $id): ?array {
  $st = db()->prepare('SELECT data FROM businesses WHERE id=?'); $st->execute([$id]);
  $d = $st->fetchColumn(); return $d ? json_decode($d, true) : null;
}
function putBiz(string $id, array $d): void {
  unset($d['id']); $d['updatedAt'] = $d['updatedAt'] ?? nowMs();
  $json = json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if (strlen($json) > 400000) throw new HttpFail('That business has too much data. Remove some notes or assets.');
  db()->prepare('INSERT INTO businesses(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at')->execute([$id, $json, nowMs()]);
}
