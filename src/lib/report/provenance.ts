export interface ProvenanceEntry { section: string; source: string; calculation: string; generatedAt: string; }

/** Creates a human-readable lineage manifest stored alongside generated sections. */
export function buildProvenanceManifest(section: string, sources: string[], calculation: string, generatedAt = new Date().toISOString()): ProvenanceEntry[] {
  return sources.filter(Boolean).map(source => ({ section, source, calculation, generatedAt }));
}

