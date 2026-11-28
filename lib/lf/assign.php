<?php
/* Telescope lead assignment workflow. Research validation stays independent from employee workflow. */
declare(strict_types=1);

const LF_ASSIGN_STATUSES = ['picked', 'in_progress', 'converted', 'sold_out'];
function lf_assign_rollback(): void { try { db()->exec('ROLLBACK'); } catch (Throwable $ignore) {} }

function lf_assign_label(string $status): string { return ['picked' => 'Picked', 'in_progress' => 'In Progress', 'converted' => 'Converted', 'sold_out' => 'Sold Out'][$status] ?? 'Available'; }
function lf_assign_business_id(array $c): ?string { $id = $c['pipeline']['hqId'] ?? null; return $id && getBiz($id) ? (string) $id : null; }
function lf_assign_status_from_business(?array $b): string {
  $status = $b['status'] ?? 'lead';
  return ['claimed' => 'picked', 'drafting' => 'in_progress', 'pitched' => 'in_progress', 'followup' => 'in_progress', 'won' => 'converted', 'lost' => 'sold_out'][$status] ?? 'available';
}
function lf_assign_record(string $businessId): ?array {
  $st = db()->prepare('SELECT * FROM lead_assignments WHERE business_id=?'); $st->execute([$businessId]); return $st->fetch() ?: null;
}
function lf_assign_history(string $businessId, int $limit = 100): array {
  $st = db()->prepare('SELECT h.*, eu.name AS employee_name, pu.name AS performed_by_name FROM lead_assignment_history h LEFT JOIN users eu ON eu.id=h.employee_id LEFT JOIN users pu ON pu.id=h.performed_by WHERE h.business_id=? ORDER BY h.id DESC LIMIT ' . max(1, min(500, $limit)));
  $st->execute([$businessId]); return $st->fetchAll();
}
function lf_assign_log(string $businessId, ?string $employeeId, string $action, ?string $previous, ?string $next, string $performedBy, string $notes = ''): void {
  db()->prepare('INSERT INTO lead_assignment_history(business_id,employee_id,action,previous_status,new_status,created_at,performed_by,notes) VALUES(?,?,?,?,?,?,?,?)')
    ->execute([$businessId, $employeeId, $action, $previous, $next, lf_now_iso(), $performedBy, mb_substr($notes, 0, 500)]);
}
function lf_assign_require_owner(array $u, array $b): void {
  lf_need(isAdmin($u) || ($b['ownerId'] ?? null) === $u['id'], 'Only the assigned employee or an admin can change this lead.', 403);
}
function lf_assign_sync_company(string $hqId, string $status, ?string $employeeId): void {
  $st = db()->prepare('SELECT data FROM businesses WHERE id=?'); $st->execute([$hqId]); $data = $st->fetchColumn(); if (!$data) return;
  $b = json_decode($data, true) ?: []; $lfId = $b['lfId'] ?? null; if (!$lfId) return;
  $c = lf_company_get((string) $lfId); if (!$c) return;
  $c['pipeline']['hqId'] = $hqId; $c['pipeline']['inPipeline'] = true; $c['pipeline']['assignmentStatus'] = $status; $c['pipeline']['assignmentEmployeeId'] = $employeeId;
  $c['pipeline']['history'][] = ['at' => lf_now_iso(), 'event' => 'Lead assignment status: ' . lf_assign_label($status)];
  lf_company_put($c);
}
function lf_assign_public(string $hqId, array $b, ?array $assignment = null): array {
  $assignment = $assignment ?: lf_assign_record($hqId);
  $employeeId = $assignment['employee_id'] ?? ($b['ownerId'] ?? null);
  return ['businessId' => $hqId, 'status' => $assignment['status'] ?? lf_assign_status_from_business($b), 'employeeId' => $employeeId, 'employeeName' => $employeeId ? userName($employeeId) : null, 'pickedAt' => $assignment['picked_at'] ?? ($b['claimedAt'] ?? null), 'updatedAt' => $assignment['updated_at'] ?? ($b['updatedAt'] ?? null)];
}
