export type HistorianQuality = 'good' | 'suspect' | 'bad' | 'missing';

export interface HistorianReading { tag: string; timestamp: string; value: number; unit: string | null; quality: HistorianQuality; source: string; }

export function normalizeHistorianRows(rows: Array<Record<string, unknown>>, source = 'historian'): HistorianReading[] {
  return rows.flatMap(row => {
    const tag = String(row.tag ?? row.name ?? row.point ?? '').trim();
    const timestamp = String(row.timestamp ?? row.ts ?? row.time ?? '').trim();
    const value = Number(row.value ?? row.val ?? row.measurement);
    if (!tag || !timestamp || !Number.isFinite(value)) return [];
    const quality = String(row.quality ?? row.status ?? 'good').toLowerCase();
    return [{ tag, timestamp, value, unit: row.unit == null ? null : String(row.unit), quality: quality === 'bad' || quality === 'suspect' || quality === 'missing' ? quality : 'good', source }];
  });
}

export function latestByTag(readings: HistorianReading[]): Map<string, HistorianReading> {
  const latest = new Map<string, HistorianReading>();
  for (const reading of readings) {
    const previous = latest.get(reading.tag);
    if (!previous || reading.timestamp > previous.timestamp) latest.set(reading.tag, reading);
  }
  return latest;
}

