<?php
/* Canvass · web API (api.php?a=<action>). Pitch HQ actions, Accounts, and Lead Finder (lf_* actions).
 * Updating the app = replace these files. Your data is never in them (see lib/core.php dataDir()). */
declare(strict_types=1);
require_once __DIR__ . '/lib/core.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

function out($data, int $code = 200): void { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE); exit; }
function bad(string $msg, int $code = 400): void { throw new HttpFail($msg, $code); }
function setCookieTok(string $v, int $exp): void {
  setcookie('canvass_t', $v, ['expires' => $exp, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', 'httponly' => true, 'samesite' => 'Lax']);
}
function clean(array $d): array {
  foreach (['name' => 120, 'notes' => 4000, 'nextStep' => 300, 'contact' => 200, 'phone' => 60, 'website' => 300, 'instagram' => 200, 'address' => 600, 'area' => 80, 'category' => 60] as $k => $max)
    if (isset($d[$k])) $d[$k] = mb_substr((string) $d[$k], 0, $max);
  if (isset($d['log']) && is_array($d['log'])) $d['log'] = array_slice(array_values($d['log']), -40);
  if (isset($d['status']) && !in_array($d['status'], ['lead', 'claimed', 'drafting', 'pitched', 'followup', 'won', 'lost'], true)) bad('Unknown stage');
  return $d;
}
function isLead(array $u, array $b): bool { return privileged($u) || empty($b['ownerId']) || $b['ownerId'] === $u['id']; }
function isHelperOf(array $u, array $b): bool { return in_array($u['id'], (array) ($b['helpers'] ?? []), true); }
function canEditBiz(array $u, array $b): bool { return isLead($u, $b) || isHelperOf($u, $b); }
const ACT_TYPES = ['meeting', 'call', 'visit', 'followup', 'note'];
function checkOwnerChange(array $u, ?array $old, $newOwner): void {
  $oldOwner = $old['ownerId'] ?? null;
  if ($newOwner === $oldOwner || privileged($u)) return;
  if ($newOwner === null && $oldOwner === $u['id']) return;              // release my own
  if ($newOwner === $u['id'] && empty($oldOwner)) return;                // claim unclaimed
  bad('Only the person who claimed it (or the admin) can change that.', 403);
}
function idOk(string $id): string { if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id)) bad('Bad id'); return $id; }
function body(): array { $b = json_decode(file_get_contents('php://input') ?: '{}', true); return is_array($b) ? $b : []; }
function deleteFile(string $fid): void {
  if (!preg_match('/^[a-z0-9]+$/', $fid)) return;
  @unlink(dataDir() . '/files/' . $fid); db()->prepare('DELETE FROM files WHERE id=?')->execute([$fid]);
}
function rollback(): void { if (db()->inTransaction()) db()->exec('ROLLBACK'); }
function assignmentStatusFromBiz(?string $status): string { return ['claimed' => 'picked', 'drafting' => 'in_progress', 'pitched' => 'in_progress', 'followup' => 'in_progress', 'won' => 'converted', 'lost' => 'sold_out'][$status ?? 'lead'] ?? 'available'; }
function recordAssignmentChange(string $id, ?array $old, array $next, array $u, ?string $action = null): void {
  if (empty($next['lfId'])) return;
  $existing = db()->prepare('SELECT * FROM lead_assignments WHERE business_id=?'); $existing->execute([$id]); $row = $existing->fetch() ?: null;
  $previous = $row['status'] ?? assignmentStatusFromBiz($old['status'] ?? 'lead'); $new = assignmentStatusFromBiz($next['status'] ?? 'lead'); $employee = $next['ownerId'] ?? ($row['employee_id'] ?? null); $now = gmdate('Y-m-d\TH:i:s.v\Z');
  if (!$employee || $new === 'available') {
    db()->prepare('DELETE FROM lead_assignments WHERE business_id=?')->execute([$id]);
    if ($previous !== 'available') db()->prepare('INSERT INTO lead_assignment_history(business_id,employee_id,action,previous_status,new_status,created_at,performed_by) VALUES(?,?,?,?,?,?,?)')->execute([$id, $row['employee_id'] ?? ($old['ownerId'] ?? null), $action ?: 'Reset', $previous, 'available', $now, $u['id']]);
    return;
  }
  db()->prepare('INSERT INTO lead_assignments(business_id,employee_id,status,picked_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(business_id) DO UPDATE SET employee_id=excluded.employee_id,status=excluded.status,updated_at=excluded.updated_at')->execute([$id, $employee, $new, $row['picked_at'] ?? $now, $now]);
  if ($previous !== $new || ($row['employee_id'] ?? null) !== $employee) db()->prepare('INSERT INTO lead_assignment_history(business_id,employee_id,action,previous_status,new_status,created_at,performed_by) VALUES(?,?,?,?,?,?,?)')->execute([$id, $employee, $action ?: (($row['employee_id'] ?? null) !== $employee ? 'Reassigned' : 'Status Changed'), $previous, $new, $now, $u['id']]);
}

/* ---------- accounts (password-locked, separate from the login password) ---------- */
const ACC_IDLE = 600;
const ACC_TYPES = ['capital', 'expense', 'income'];
const REC_FREQ = ['monthly', 'quarterly', 'yearly', 'once'];
function accUnlocked(array $u): bool { return (int) ($u['acc_until'] ?? 0) > time(); }
function accTouch(): void { db()->prepare('UPDATE sessions SET acc_until=? WHERE token_hash=?')->execute([time() + ACC_IDLE, tokenHash()]); }
function accNeed(array $u): void { if (!accUnlocked($u)) bad('Accounts are locked. Enter the accounts password again.', 423); accTouch(); }
function accRows(string $table): array { $o = []; foreach (db()->query("SELECT id,data FROM $table") as $r) { $d = json_decode($r['data'], true); $d['id'] = $r['id']; $o[] = $d; } return $o; }
function recList(bool $withAmounts): array { return array_map(function ($x) use ($withAmounts) { if (!$withAmounts) $x['amount'] = null; return $x; }, accRows('acc_rec')); }
function userOk(string $id): bool { $st = db()->prepare('SELECT COUNT(*) FROM users WHERE id=?'); $st->execute([$id]); return (int) $st->fetchColumn() > 0; }

/* ---------- router ---------- */
$a = (string) ($_GET['a'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
if ($method === 'POST' && ($_SERVER['HTTP_X_CANVASS'] ?? '') !== '1') bad('Bad request', 400); // blocks cross-site form posts

// Seeded accounts and admin resets use temporary passwords: nothing else works until a new one is chosen.
if (!in_array($a, ['me', 'login', 'logout', 'password', 'sync'], true)) { $cu = me(false); if ($cu && (int) ($cu['must_change_pw'] ?? 0) === 1) bad('Choose a new password first.', 403); }

if (str_starts_with($a, 'lf_')) {                                    // Lead Finder
  require_once __DIR__ . '/lib/lf/api.php';
  $u = me();
  if ($method !== 'POST' && !in_array($a, ['lf_health', 'lf_settings', 'lf_dashboard', 'lf_companies', 'lf_company', 'lf_jobs', 'lf_job', 'lf_history', 'lf_usage', 'lf_export', 'lf_backup_download', 'lf_backups', 'lf_schedules', 'lf_lead_history', 'lf_lead_overview', 'lf_filter_options', 'lf_filter_prefs', 'lf_trash'], true)) bad('Use POST for that.', 405);
  lf_install_http_hooks();
  out(lf_dispatch($a, $u, $method === 'POST' ? body() : []));
}

switch ($a) {

case 'me':
  $u = me(false); out(['user' => $u ? meOut($u) : null, 'version' => APP_VERSION]);

case 'login': {
  $b = body(); $pdo = db();
  $pdo->prepare('DELETE FROM attempts WHERE at<?')->execute([time() - 900]);
  $c = $pdo->prepare('SELECT COUNT(*) FROM attempts WHERE ip=?'); $c->execute([ip()]);
  if ((int) $c->fetchColumn() >= 10) bad('Too many tries. Wait 15 minutes and try again.', 429);
  $st = $pdo->prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1'); $st->execute([trim((string) ($b['username'] ?? ''))]);
  $u = $st->fetch();
  if (!$u || !password_verify((string) ($b['password'] ?? ''), $u['pass_hash'])) {
    $pdo->prepare('INSERT INTO attempts(ip,at) VALUES(?,?)')->execute([ip(), time()]);
    bad('Wrong username or password.', 401);
  }
  $tok = bin2hex(random_bytes(32)); $exp = time() + SESSION_DAYS * 86400;
  $pdo->prepare('DELETE FROM sessions WHERE expires<?')->execute([time()]);
  $pdo->prepare('INSERT INTO sessions(token_hash,user_id,expires,created,acc_until) VALUES(?,?,?,?,0)')->execute([hash('sha256', $tok), $u['id'], $exp, time()]);
  setCookieTok($tok, $exp);
  out(['user' => meOut($u)]);
}

case 'logout':
  if (tokenHash() !== '') db()->prepare('DELETE FROM sessions WHERE token_hash=?')->execute([tokenHash()]);
  setCookieTok('', time() - 3600); out(['ok' => true]);

case 'sync': {
  $u = me(); $r = rev();
  if (($_GET['acc'] ?? '') === '1' && accUnlocked($u)) accTouch();      // Accounts stays open while it is in use
  $extra = ['rec' => recList(accUnlocked($u)), 'accHasPw' => meta_get('acc_pw_hash') !== null, 'accUnlocked' => accUnlocked($u)];
  if (isset($_GET['rev']) && (int) $_GET['rev'] === $r) out(['rev' => $r, 'same' => true, 'me' => meOut($u)] + $extra);
  $biz = [];
  foreach (db()->query('SELECT id,data FROM businesses') as $row) { $d = json_decode($row['data'], true); $d['id'] = $row['id']; $biz[] = $d; }
  $mem = array_map('pubUser', db()->query('SELECT * FROM users ORDER BY joined_at')->fetchAll());
  out(['rev' => $r, 'me' => meOut($u), 'businesses' => $biz, 'members' => $mem] + $extra);
}

case 'biz_set': {                       // create (or restore after delete)
  $u = me(); $b = body(); $id = idOk((string) ($b['id'] ?? '')); $d = clean((array) ($b['data'] ?? []));
  $pdo = db(); $pdo->exec('BEGIN IMMEDIATE');
  if (getBiz($id)) bad('That business already exists.', 409);
  $ts = $pdo->prepare('SELECT data FROM tombstones WHERE id=?'); $ts->execute([$id]); $tomb = $ts->fetchColumn();
  if ($tomb) { $t = json_decode($tomb, true); $d['createdBy'] = $t['createdBy'] ?? $u['id']; $d['createdAt'] = $t['createdAt'] ?? nowMs(); $pdo->prepare('DELETE FROM tombstones WHERE id=?')->execute([$id]); }
  else { $d['createdBy'] = $u['id']; $d['createdAt'] = nowMs(); checkOwnerChange($u, null, $d['ownerId'] ?? null); }
  if (!isset($d['name']) || trim((string) $d['name']) === '') bad('Give the business a name');
  putBiz($id, $d); bump(); $pdo->exec('COMMIT'); out(['ok' => true, 'rev' => rev()]);
}

case 'biz_update': {
  $u = me(); $b = body(); $id = idOk((string) ($b['id'] ?? '')); $patch = clean((array) ($b['patch'] ?? []));
  unset($patch['createdBy'], $patch['createdAt'], $patch['id'], $patch['activities'], $patch['lfId']);
  $pdo = db(); $pdo->exec('BEGIN IMMEDIATE');
  $old = getBiz($id);
  if (!$old) bad('That business was deleted.', 404);
  if (!canEditBiz($u, $old)) bad(explode(' ', userName((string) $old['ownerId']))[0] . ' claimed this. Only they, their helpers or the admin can edit it.', 403);
  if (!isLead($u, $old)) {                                  // helpers: details yes, stage/owner/team no
    foreach (['status', 'ownerId', 'helpers', 'claimedAt', 'pitchedAt', 'wonAt'] as $k)
      if (array_key_exists($k, $patch) && $patch[$k] != ($old[$k] ?? null)) bad('You’re a helper on this. Only ' . explode(' ', userName((string) $old['ownerId']))[0] . ' (owner) or the admin can move it or change the team.', 403);
  }
  if (array_key_exists('helpers', $patch)) {
    $act = db()->query('SELECT id FROM users WHERE active=1')->fetchAll(PDO::FETCH_COLUMN);
    $owner = array_key_exists('ownerId', $patch) ? $patch['ownerId'] : ($old['ownerId'] ?? null);
    $patch['helpers'] = array_values(array_slice(array_unique(array_filter((array) $patch['helpers'], fn($h) => is_string($h) && $h !== $owner && in_array($h, $act, true))), 0, 10));
  }
  if (array_key_exists('ownerId', $patch)) checkOwnerChange($u, $old, $patch['ownerId']);
  if (isset($patch['assets']) && is_array($patch['assets'])) {      // removed uploaded files are deleted from disk
    $keep = array_filter(array_map(fn($x) => $x['assetId'] ?? null, $patch['assets']));
    foreach (($old['assets'] ?? []) as $x) if (!empty($x['assetId']) && !in_array($x['assetId'], $keep, true)) deleteFile((string) $x['assetId']);
  }
  $next = array_merge($old, $patch); putBiz($id, $next); recordAssignmentChange($id, $old, $next, $u); bump(); $pdo->exec('COMMIT'); out(['ok' => true, 'rev' => rev()]);
}

case 'claim': {                         // race-safe: one transaction, first one wins
  $u = me(); $b = body(); $id = idOk((string) ($b['id'] ?? ''));
  $pdo = db(); $pdo->exec('BEGIN IMMEDIATE');
  $d = getBiz($id);
  if (!$d) bad('That business was deleted.', 404);
  if (!empty($d['ownerId']) && $d['ownerId'] !== $u['id']) throw new HttpFail(explode(' ', userName((string) $d['ownerId']))[0] . ' got there first', 409, ['taken' => true]);
  $t = nowMs();
  $d['ownerId'] = $u['id']; $d['claimedAt'] = $t; if (($d['status'] ?? 'lead') === 'lead') $d['status'] = 'claimed';
  $d['updatedAt'] = $t; $d['log'] = array_slice(array_merge($d['log'] ?? [], [['by' => $u['id'], 'at' => $t, 't' => 'claimed it']]), -40);
  putBiz($id, $d); recordAssignmentChange($id, null, $d, $u, 'Picked'); bump(); $pdo->exec('COMMIT'); out(['ok' => true, 'rev' => rev()]);
}

case 'act_add': {                       // anyone on the team can log activity or comment on any business
  $u = me(); $b = body(); $id = idOk((string) ($b['id'] ?? '')); $act = (array) ($b['act'] ?? []);
  $type = in_array($act['type'] ?? '', ACT_TYPES, true) ? $act['type'] : 'note';
  $note = trim(mb_substr((string) ($act['note'] ?? ''), 0, 1000));
  if ($type === 'note' && $note === '') bad('Write something first.');
  $who = (string) ($act['who'] ?? $u['id']); $chk = db()->prepare('SELECT COUNT(*) FROM users WHERE id=? AND active=1'); $chk->execute([$who]); if (!(int) $chk->fetchColumn()) $who = $u['id'];
  $when = $type === 'note' ? nowMs() : (int) ($act['when'] ?? 0); if ($when <= 0) bad('Pick a date and time.');
  $aid = preg_match('/^[A-Za-z0-9_-]{4,40}$/', (string) ($act['id'] ?? '')) ? $act['id'] : gid();
  $pdo = db(); $pdo->exec('BEGIN IMMEDIATE');
  $d = getBiz($id); if (!$d) bad('That business was deleted.', 404);
  $acts = (array) ($d['activities'] ?? []);
  foreach ($acts as $x) if (($x['id'] ?? '') === $aid) { rollback(); out(['ok' => true]); }
  $acts[] = ['id' => $aid, 'type' => $type, 'who' => $who, 'when' => $when, 'note' => $note, 'by' => $u['id'], 'at' => nowMs()];
  $d['activities'] = array_slice($acts, -300);
  $labels = ['meeting' => 'a meeting', 'call' => 'a call', 'visit' => 'a visit', 'followup' => 'a follow-up'];
  $t = $type === 'note' ? 'commented' : 'logged ' . $labels[$type] . ($who !== $u['id'] ? ' for ' . explode(' ', userName($who))[0] : '');
  $d['log'] = array_slice(array_merge($d['log'] ?? [], [['by' => $u['id'], 'at' => nowMs(), 't' => $t]]), -40);
  $d['updatedAt'] = nowMs();
  putBiz($id, $d); bump(); $pdo->exec('COMMIT'); out(['ok' => true, 'rev' => rev()]);
}

case 'act_delete': {                    // the person who wrote it, the owner, or the admin
  $u = me(); $b = body(); $id = idOk((string) ($b['id'] ?? '')); $aid = (string) ($b['actId'] ?? '');
  $pdo = db(); $pdo->exec('BEGIN IMMEDIATE');
  $d = getBiz($id); if (!$d) bad('That business was deleted.', 404);
  $acts = (array) ($d['activities'] ?? []); $found = null;
  foreach ($acts as $x) if (($x['id'] ?? '') === $aid) $found = $x;
  if (!$found) { rollback(); out(['ok' => true]); }
  if (($found['by'] ?? '') !== $u['id'] && ($d['ownerId'] ?? '') !== $u['id'] && !privileged($u)) bad('Only ' . explode(' ', userName((string) ($found['by'] ?? '')))[0] . ', the owner or the admin can remove this.', 403);
  $d['activities'] = array_values(array_filter($acts, fn($x) => ($x['id'] ?? '') !== $aid));
  $d['updatedAt'] = nowMs();
  putBiz($id, $d); bump(); $pdo->exec('COMMIT'); out(['ok' => true, 'rev' => rev()]);
}

case 'biz_delete': {
  $u = me(); $b = body(); $id = idOk((string) ($b['id'] ?? ''));
  $pdo = db(); $pdo->exec('BEGIN IMMEDIATE');
  $d = getBiz($id);
  if (!$d) { rollback(); out(['ok' => true]); }
  if (!isAdmin($u) && ($d['createdBy'] ?? '') !== $u['id']) bad('Only the admin or the person who added it can delete this.', 403);
  $pdo->prepare('INSERT OR REPLACE INTO tombstones(id,data,deleted_at) VALUES(?,?,?)')->execute([$id, json_encode($d, JSON_UNESCAPED_UNICODE), nowMs()]);
  $pdo->prepare('DELETE FROM businesses WHERE id=?')->execute([$id]);
  $pdo->prepare('DELETE FROM tombstones WHERE deleted_at<?')->execute([nowMs() - 30 * 86400000]);
  bump(); $pdo->exec('COMMIT'); out(['ok' => true, 'rev' => rev()]);
}

case 'member_update': {                 // your own colour, focus, light/dark, mentions read
  $u = me(); $b = body(); $sets = []; $vals = [];
  if (isset($b['colorIdx'])) { $sets[] = 'color_idx=?'; $vals[] = max(0, min(NPC - 1, (int) $b['colorIdx'])); }
  if (isset($b['focus'])) { $sets[] = 'focus=?'; $vals[] = mb_substr((string) $b['focus'], 0, 80); }
  if (isset($b['mentionsSeen'])) { $sets[] = 'mentions_seen=?'; $vals[] = max(0, (int) $b['mentionsSeen']); }
  if (isset($b['theme'])) { $sets[] = 'theme=?'; $vals[] = in_array($b['theme'], ['light', 'dark', ''], true) ? $b['theme'] : ''; }
  if ($sets) { $vals[] = nowMs(); $vals[] = $u['id']; db()->prepare('UPDATE users SET ' . implode(',', $sets) . ',updated_at=? WHERE id=?')->execute($vals); if (isset($b['colorIdx']) || isset($b['focus'])) bump(); }
  out(['ok' => true]);
}

case 'password': {                      // change your own password
  $u = me(); $b = body(); $new = (string) ($b['new'] ?? '');
  if (!password_verify((string) ($b['current'] ?? ''), $u['pass_hash'])) bad('Your current password isn’t right.', 403);
  if (mb_strlen($new) < 3) bad('Use at least 3 characters.');
  if (password_verify($new, $u['pass_hash'])) bad('Choose a password that is different from the current one.');
  db()->prepare('UPDATE users SET pass_hash=?, must_change_pw=0, updated_at=? WHERE id=?')->execute([password_hash($new, PASSWORD_DEFAULT), nowMs(), $u['id']]);
  db()->prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?')->execute([$u['id'], tokenHash()]);   // sign out other devices
  out(['ok' => true]);
}

case 'upload': {
  $u = me(); $f = $_FILES['file'] ?? null;
  if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK) bad(($f['error'] ?? 0) === UPLOAD_ERR_INI_SIZE ? 'That file is too big for the server.' : 'Upload failed. Try again.');
  if ($f['size'] > MAX_UPLOAD) bad('Files must be 25 MB or smaller.');
  $fid = strtolower(gid());
  if (!move_uploaded_file($f['tmp_name'], dataDir() . '/files/' . $fid)) bad('Couldn’t store the file.', 500);
  $type = (function_exists('mime_content_type') ? @mime_content_type(dataDir() . '/files/' . $fid) : '') ?: ($f['type'] ?: 'application/octet-stream');
  $name = mb_substr(preg_replace('/[\x00-\x1f"\\\\\/]/u', '_', (string) $f['name']), 0, 160);
  db()->prepare('INSERT INTO files(id,name,type,size,by_user,at) VALUES(?,?,?,?,?,?)')->execute([$fid, $name, $type, (int) $f['size'], $u['id'], nowMs()]);
  out(['id' => $fid, 'url' => 'api.php?a=file&id=' . $fid, 'contentType' => $type, 'sizeBytes' => (int) $f['size']]);
}

case 'file': {
  me(); $fid = (string) ($_GET['id'] ?? '');
  $st = db()->prepare('SELECT * FROM files WHERE id=?'); $st->execute([$fid]); $f = $st->fetch();
  $path = dataDir() . '/files/' . $fid;
  if (!$f || !preg_match('/^[a-z0-9]+$/', $fid) || !is_file($path)) { header('Content-Type: text/plain'); http_response_code(404); echo 'Not found'; exit; }
  $inline = preg_match('#^(image/(png|jpe?g|gif|webp|avif)|application/pdf|video/|audio/)#', $f['type']);
  header('Content-Type: ' . $f['type']);
  header('Content-Length: ' . filesize($path));
  header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . $f['name'] . '"');
  header('Content-Security-Policy: sandbox; default-src \'none\'; img-src \'self\' data:; style-src \'unsafe-inline\'; media-src \'self\'');
  header('Cache-Control: private, max-age=86400');
  readfile($path); exit;
}

/* ---------- accounts ---------- */
case 'acc_unlock': {
  $u = me(); $b = body(); $pw = (string) ($b['password'] ?? ''); $hash = meta_get('acc_pw_hash'); $created = false;
  $pdo = db(); $pdo->prepare('DELETE FROM attempts WHERE at<?')->execute([time() - 900]);
  $c = $pdo->prepare('SELECT COUNT(*) FROM attempts WHERE ip=?'); $c->execute(['acc:' . ip()]);
  if ((int) $c->fetchColumn() >= 10) bad('Too many tries. Wait 15 minutes and try again.', 429);
  if ($hash === null) {                                             // first use: the admin's first password becomes the accounts password
    if (!isAdmin($u)) bad('The admin hasn’t set an accounts password yet.', 403);
    if (mb_strlen($pw) < 6) bad('Choose an accounts password of at least 6 characters. This sets it for everyone.');
    meta_set('acc_pw_hash', password_hash($pw, PASSWORD_DEFAULT)); $created = true;
  } elseif (!password_verify($pw, $hash)) { $pdo->prepare('INSERT INTO attempts(ip,at) VALUES(?,?)')->execute(['acc:' . ip(), time()]); bad('Wrong password', 403); }
  accTouch();
  out(['entries' => accRows('acc_entries'), 'rec' => recList(true), 'created' => $created]);
}
case 'acc_lock': me(); db()->prepare('UPDATE sessions SET acc_until=0 WHERE token_hash=?')->execute([tokenHash()]); out(['ok' => true]);
case 'acc_save': {
  $u = me(); accNeed($u); $b = body(); $e = (array) ($b['entry'] ?? []);
  $id = idOk((string) ($e['id'] ?? '')); $type = (string) ($e['type'] ?? '');
  if (!in_array($type, ACC_TYPES, true)) bad('Pick capital, expense or income.');
  $amt = is_numeric($e['amount'] ?? null) ? round((float) $e['amount'], 2) : 0; if ($amt <= 0 || $amt > 1e9) bad('Enter an amount above 0');
  $who = (string) ($e['who'] ?? $u['id']); if (!userOk($who)) $who = $u['id'];
  $st = db()->prepare('SELECT data FROM acc_entries WHERE id=?'); $st->execute([$id]); $old = json_decode((string) $st->fetchColumn(), true) ?: [];
  $doc = ['type' => $type, 'amount' => $amt, 'date' => max(0, (int) ($e['date'] ?? nowMs())), 'cat' => mb_substr((string) ($e['cat'] ?? 'Other'), 0, 60), 'who' => $who, 'note' => mb_substr(trim((string) ($e['note'] ?? '')), 0, 160),
    'createdBy' => $old['createdBy'] ?? $u['id'], 'createdAt' => $old['createdAt'] ?? nowMs(), 'updatedAt' => nowMs(), 'updatedBy' => $u['id']];
  db()->prepare('INSERT INTO acc_entries(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')->execute([$id, json_encode($doc, JSON_UNESCAPED_UNICODE), nowMs()]);
  out(['ok' => true]);
}
case 'acc_delete': { $u = me(); accNeed($u); $b = body(); db()->prepare('DELETE FROM acc_entries WHERE id=?')->execute([(string) ($b['id'] ?? '')]); out(['ok' => true]); }
case 'acc_setpw': {
  $u = me(); if (!isAdmin($u)) bad('Only the admin can change the accounts password.', 403);
  $b = body(); $hash = meta_get('acc_pw_hash');
  if ($hash !== null && !password_verify((string) ($b['current'] ?? ''), $hash)) bad('Current password is wrong', 403);
  $new = (string) ($b['password'] ?? ''); if (mb_strlen($new) < 6) bad('New password needs at least 6 characters');
  meta_set('acc_pw_hash', password_hash($new, PASSWORD_DEFAULT));
  db()->prepare('UPDATE sessions SET acc_until=0 WHERE token_hash<>?')->execute([tokenHash()]);      // everyone else needs the new password
  out(['ok' => true]);
}
case 'rec_save': {
  $u = me(); accNeed($u); $b = body(); $x = (array) ($b['item'] ?? []); $id = idOk((string) ($x['id'] ?? ''));
  if (!empty($x['deleted'])) { db()->prepare('DELETE FROM acc_rec WHERE id=?')->execute([$id]); bump(); out(['ok' => true]); }
  $name = mb_substr(trim((string) ($x['name'] ?? '')), 0, 80); if ($name === '') bad('Give it a name');
  $amt = is_numeric($x['amount'] ?? null) ? round((float) $x['amount'], 2) : -1; if ($amt < 0) bad('Enter the amount');
  $next = (string) ($x['next'] ?? ''); if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $next)) bad('Pick the next due date');
  $who = (string) ($x['who'] ?? $u['id']); if (!userOk($who)) $who = $u['id'];
  $doc = ['name' => $name, 'amount' => $amt, 'freq' => in_array($x['freq'] ?? '', REC_FREQ, true) ? $x['freq'] : 'monthly', 'next' => $next, 'remind' => max(0, min(60, (int) ($x['remind'] ?? 7))),
    'cat' => mb_substr((string) ($x['cat'] ?? 'Other'), 0, 60), 'who' => $who, 'notes' => mb_substr(trim((string) ($x['notes'] ?? '')), 0, 160), 'updatedAt' => nowMs()];
  db()->prepare('INSERT INTO acc_rec(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')->execute([$id, json_encode($doc, JSON_UNESCAPED_UNICODE), nowMs()]);
  bump(); out(['ok' => true]);
}

/* ---------- admin ---------- */
case 'admin_users': {
  $u = me(); if (!isAdmin($u)) bad('Admins only', 403);
  $rows = db()->query('SELECT * FROM users ORDER BY active DESC, joined_at')->fetchAll();
  out(['users' => array_map(fn($r) => pubUser($r) + ['username' => $r['username'], 'mustChangePassword' => (int) ($r['must_change_pw'] ?? 0) === 1], $rows)]);   // passwords are never returned: only hashes are stored
}

case 'admin_user_save': {
  $u = me(); if (!isAdmin($u)) bad('Admins only', 403);
  $b = body(); $pdo = db(); $id = (string) ($b['id'] ?? '');
  $username = trim((string) ($b['username'] ?? '')); $name = trim((string) ($b['name'] ?? ''));
  if (!preg_match('/^[A-Za-z0-9._-]{2,32}$/', $username)) bad('Usernames are 2–32 letters, numbers, dots, dashes or underscores. No spaces.');
  if ($name === '') bad('Add a name to show the team.');
  $role = ($b['role'] ?? 'Scout') === 'Designer' ? 'Designer' : 'Scout';
  $admin = !empty($b['isAdmin']) ? 1 : 0; $active = array_key_exists('active', $b) ? (!empty($b['active']) ? 1 : 0) : 1;
  $pw = isset($b['password']) ? (string) $b['password'] : null;
  if ($pw !== null && $pw !== '' && mb_strlen($pw) < 3) bad('Passwords need at least 3 characters.');
  $dupe = $pdo->prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE AND id<>?'); $dupe->execute([$username, $id]);
  if ($dupe->fetchColumn()) bad('That username is taken.');
  if ($id === '') {
    if ($pw === null || $pw === '') bad('Set a password for the new person.');
    $used = array_map('intval', $pdo->query('SELECT color_idx FROM users WHERE active=1')->fetchAll(PDO::FETCH_COLUMN));
    $ci = 0; while (in_array($ci, $used, true) && $ci < NPC) $ci++;
    $pdo->prepare('INSERT INTO users(id,username,name,pass_hash,role,is_admin,color_idx,active,must_change_pw,joined_at,updated_at) VALUES(?,?,?,?,?,?,?,1,1,?,?)')   // temporary password: changed at first sign-in
      ->execute(['u_' . bin2hex(random_bytes(5)), $username, mb_substr($name, 0, 60), password_hash($pw, PASSWORD_DEFAULT), $role, $admin, $ci % NPC, nowMs(), nowMs()]);
  } else {
    $cur = $pdo->prepare('SELECT * FROM users WHERE id=?'); $cur->execute([$id]); $c = $cur->fetch(); if (!$c) bad('Person not found', 404);
    if ($id === $u['id'] && (!$admin || !$active)) bad('You can’t remove your own admin access.');
    $pdo->prepare('UPDATE users SET username=?, name=?, role=?, is_admin=?, active=?, updated_at=? WHERE id=?')->execute([$username, mb_substr($name, 0, 60), $role, $admin, $active, nowMs(), $id]);
    if ($pw !== null && $pw !== '') $pdo->prepare('UPDATE users SET pass_hash=?, must_change_pw=? WHERE id=?')->execute([password_hash($pw, PASSWORD_DEFAULT), $id === $u['id'] ? 0 : 1, $id]);   // a reset is temporary for others
    if (!$active || ($pw !== null && $pw !== '' && $id !== $u['id'])) $pdo->prepare('DELETE FROM sessions WHERE user_id=?')->execute([$id]); // sign them out everywhere
  }
  bump(); out(['ok' => true]);
}

default: bad('Unknown action', 404);
}
} catch (HttpFail $e) { rollback(); out(['error' => $e->getMessage()] + $e->extra, $e->http); }
catch (ApiError $e) { rollback(); out(['error' => $e->getMessage()], 400); }
catch (Throwable $e) { rollback(); error_log('[canvass] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine()); out(['error' => 'Server error. Try again.'], 500); }
