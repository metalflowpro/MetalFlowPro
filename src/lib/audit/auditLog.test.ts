import { describe, it, expect, beforeEach } from 'vitest';
import { logAuditEvent, fetchAuditLogs, clearInMemoryAuditLogs } from './auditLog';

describe('Audit Log & Traceability System', () => {
  beforeEach(() => {
    clearInMemoryAuditLogs();
  });

  it('should log audit event into memory and return formatted entry', async () => {
    const entry = await logAuditEvent({
      projectId: 'proj-123',
      action: 'update_settings',
      entityType: 'project_settings',
      entityId: 'set-456',
      previousValues: { discount_rate_pct: 8 },
      newValues: { discount_rate_pct: 10 },
      metadata: { reason: 'PFS scenario' },
    });

    expect(entry).not.toBeNull();
    expect(entry?.project_id).toBe('proj-123');
    expect(entry?.action).toBe('update_settings');
    expect(entry?.previous_values).toEqual({ discount_rate_pct: 8 });
    expect(entry?.new_values).toEqual({ discount_rate_pct: 10 });
  });

  it('should retrieve logs filtered by project id', async () => {
    await logAuditEvent({
      projectId: 'proj-A',
      action: 'run_simulation',
      entityType: 'simulation_run',
    });

    await logAuditEvent({
      projectId: 'proj-B',
      action: 'approve_stage',
      entityType: 'stage_gate',
    });

    const logsA = await fetchAuditLogs('proj-A');
    expect(logsA).toHaveLength(1);
    expect(logsA[0].project_id).toBe('proj-A');
    expect(logsA[0].action).toBe('run_simulation');
  });
});
