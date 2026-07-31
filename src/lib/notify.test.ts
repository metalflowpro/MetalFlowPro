import { describe, it, expect, beforeEach } from 'vitest';
import {
  notify, notifyError, notifySuccess,
  subscribeNotifications, dismissNotification,
} from './notify';

describe('notify — bus de notifications', () => {
  beforeEach(() => {
    // Vide la pile entre les tests via l'abonnement courant.
    let current: number[] = [];
    const unsub = subscribeNotifications(list => { current = list.map(n => n.id); });
    current.forEach(dismissNotification);
    unsub();
  });

  it('publie et diffuse aux abonnés', () => {
    let received = 0;
    const unsub = subscribeNotifications(list => { received = list.length; });
    notifyError('échec test');
    expect(received).toBeGreaterThan(0);
    unsub();
  });

  it('donne l\'état courant à l\'abonnement', () => {
    notifyError('persistant');
    let snapshot: string[] = [];
    const unsub = subscribeNotifications(list => { snapshot = list.map(n => n.message); });
    expect(snapshot).toContain('persistant');
    unsub();
  });

  it('conserve les erreurs et laisse le message + détail', () => {
    let last: { level: string; message: string; detail?: string } | undefined;
    const unsub = subscribeNotifications(list => { last = list[list.length - 1]; });
    notifyError('Échec enregistrement', 'RLS violation');
    expect(last?.level).toBe('error');
    expect(last?.message).toBe('Échec enregistrement');
    expect(last?.detail).toBe('RLS violation');
    unsub();
  });

  it('permet la fermeture manuelle', () => {
    let ids: number[] = [];
    const unsub = subscribeNotifications(list => { ids = list.map(n => n.id); });
    const id = notifyError('à fermer');
    expect(ids).toContain(id);
    dismissNotification(id);
    expect(ids).not.toContain(id);
    unsub();
  });

  it('borne la pile à 6 notifications', () => {
    let count = 0;
    const unsub = subscribeNotifications(list => { count = list.length; });
    for (let i = 0; i < 12; i++) notify('info', `msg ${i}`);
    expect(count).toBeLessThanOrEqual(6);
    unsub();
  });

  it('expose des raccourcis typés', () => {
    let last: string | undefined;
    const unsub = subscribeNotifications(list => { last = list[list.length - 1]?.level; });
    notifySuccess('ok');
    expect(last).toBe('success');
    unsub();
  });
});
