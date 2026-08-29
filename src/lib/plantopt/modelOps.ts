// ─────────────────────────────────────────────────────────────────────────────
// Plant Optimizer — Opérations de mutation IMMUABLE du modèle
//
// Fonctions pures partagées par la page et ses composants d'édition : ajouter/
// supprimer une aire, régler une capacité, un flux, un tampon, un mode de
// défaillance, une cause commune. Chacune renvoie un nouveau PlantModel.
// ─────────────────────────────────────────────────────────────────────────────

import { makeNewArea, makePlantOptId } from './projectModel';
import type {
  Area, CommonCause, DistributionSpec, FailureMode, PlantModel, Stream,
} from './types';

export function patchArea(model: PlantModel, id: string, patch: Partial<Area>): PlantModel {
  return { ...model, areas: model.areas.map(a => (a.id === id ? { ...a, ...patch } : a)) };
}

/** Règle un paramètre de la loi de capacité d'une aire (min/mode/max…). */
export function setCapacityParam(model: PlantModel, id: string, key: string, value: number): PlantModel {
  return {
    ...model,
    areas: model.areas.map(a =>
      a.id === id ? { ...a, capacityDist: { ...a.capacityDist, params: { ...a.capacityDist.params, [key]: value } } } : a,
    ),
  };
}

export function setCapacityDist(model: PlantModel, id: string, spec: DistributionSpec): PlantModel {
  return patchArea(model, id, { capacityDist: spec });
}

export function addArea(model: PlantModel): { model: PlantModel; newId: string } {
  const { area, stream } = makeNewArea(model);
  return {
    model: { ...model, areas: [...model.areas, area], streams: stream ? [...model.streams, stream] : model.streams },
    newId: area.id,
  };
}

export function deleteArea(model: PlantModel, id: string): PlantModel {
  return {
    ...model,
    areas: model.areas.filter(a => a.id !== id),
    streams: model.streams.filter(s => s.sourceAreaId !== id && s.targetAreaId !== id),
    buffers: (model.buffers ?? []).filter(b => b.upstreamAreaId !== id && b.downstreamAreaId !== id),
    failureModes: (model.failureModes ?? []).filter(f => f.areaId !== id),
    plannedStops: (model.plannedStops ?? []).map(p => ({ ...p, areaIds: p.areaIds.filter(x => x !== id) })).filter(p => p.areaIds.length > 0),
    commonCauses: (model.commonCauses ?? []).map(c => ({ ...c, areaIds: c.areaIds.filter(x => x !== id) })).filter(c => c.areaIds.length > 0),
  };
}

export function getFailureMode(model: PlantModel, areaId: string): FailureMode | undefined {
  return (model.failureModes ?? []).find(f => f.areaId === areaId);
}

export function setFailureDist(model: PlantModel, areaId: string, key: 'ttfDist' | 'ttrDist', spec: DistributionSpec): PlantModel {
  const existing = getFailureMode(model, areaId);
  if (existing) {
    return { ...model, failureModes: model.failureModes.map(f => (f.id === existing.id ? { ...f, [key]: spec } : f)) };
  }
  const fm: FailureMode = {
    id: makePlantOptId('fm'),
    areaId,
    residualCapacity: 0,
    ttfDist: key === 'ttfDist' ? spec : { kind: 'weibull', params: { shape: 1.4, scale: 300 } },
    ttrDist: key === 'ttrDist' ? spec : { kind: 'lognormal', params: { mu: 1.8, sigma: 0.6 } },
  };
  return { ...model, failureModes: [...(model.failureModes ?? []), fm] };
}

// ── Flux & tampons ────────────────────────────────────────────────────────────

export function findBuffer(model: PlantModel, sourceId: string, targetId: string) {
  return (model.buffers ?? []).find(b => b.upstreamAreaId === sourceId && b.downstreamAreaId === targetId);
}

export function setStreamYield(model: PlantModel, streamId: string, yieldFraction: number): PlantModel {
  return { ...model, streams: model.streams.map(s => (s.id === streamId ? { ...s, massYield: Math.max(0, yieldFraction) } : s)) };
}

/** Active/désactive un tampon sur un flux (capacité par défaut relative au débit). */
export function toggleBuffer(model: PlantModel, sourceId: string, targetId: string, defaultCapacity: number): PlantModel {
  const existing = findBuffer(model, sourceId, targetId);
  if (existing) {
    return { ...model, buffers: (model.buffers ?? []).filter(b => b.id !== existing.id) };
  }
  return {
    ...model,
    buffers: [
      ...(model.buffers ?? []),
      { id: makePlantOptId('buffer'), upstreamAreaId: sourceId, downstreamAreaId: targetId, capacityTonnes: defaultCapacity, initialLevel: defaultCapacity / 2 },
    ],
  };
}

export function setBufferCapacity(model: PlantModel, bufferId: string, capacityTonnes: number): PlantModel {
  return {
    ...model,
    buffers: (model.buffers ?? []).map(b =>
      b.id === bufferId ? { ...b, capacityTonnes, initialLevel: Math.min(b.initialLevel ?? capacityTonnes / 2, capacityTonnes) } : b,
    ),
  };
}

export function addStream(model: PlantModel, sourceId: string, targetId: string): PlantModel {
  if (sourceId === targetId) return model;
  if (model.streams.some(s => s.sourceAreaId === sourceId && s.targetAreaId === targetId)) return model;
  const stream: Stream = { id: makePlantOptId('stream'), sourceAreaId: sourceId, targetAreaId: targetId, massYield: 1 };
  return { ...model, streams: [...model.streams, stream] };
}

export function deleteStream(model: PlantModel, streamId: string): PlantModel {
  const s = model.streams.find(x => x.id === streamId);
  if (!s) return model;
  return {
    ...model,
    streams: model.streams.filter(x => x.id !== streamId),
    buffers: (model.buffers ?? []).filter(b => !(b.upstreamAreaId === s.sourceAreaId && b.downstreamAreaId === s.targetAreaId)),
  };
}

// ── Causes communes ─────────────────────────────────────────────────────────

export function addCommonCause(model: PlantModel): PlantModel {
  const cc: CommonCause = {
    id: makePlantOptId('cc'),
    areaIds: [],
    beta: 0.1,
    ttfDist: { kind: 'exponential', params: { rate: 1 / 2000 } },
    ttrDist: { kind: 'lognormal', params: { mu: Math.log(3), sigma: 0.5 } },
  };
  return { ...model, commonCauses: [...(model.commonCauses ?? []), cc] };
}

export function updateCommonCause(model: PlantModel, id: string, patch: Partial<CommonCause>): PlantModel {
  return { ...model, commonCauses: (model.commonCauses ?? []).map(c => (c.id === id ? { ...c, ...patch } : c)) };
}

export function deleteCommonCause(model: PlantModel, id: string): PlantModel {
  return { ...model, commonCauses: (model.commonCauses ?? []).filter(c => c.id !== id) };
}

export function toggleCommonCauseArea(model: PlantModel, ccId: string, areaId: string): PlantModel {
  return {
    ...model,
    commonCauses: (model.commonCauses ?? []).map(c => {
      if (c.id !== ccId) return c;
      const has = c.areaIds.includes(areaId);
      return { ...c, areaIds: has ? c.areaIds.filter(x => x !== areaId) : [...c.areaIds, areaId] };
    }),
  };
}

// ── Scénario d'alimentation ──────────────────────────────────────────────────

export function updateFeedScenario(model: PlantModel, patch: Partial<NonNullable<PlantModel['feedScenario']>>): PlantModel {
  return { ...model, feedScenario: { ...(model.feedScenario ?? {}), ...patch } };
}

/** Position d'une aire sur le canvas. */
export function setAreaPosition(model: PlantModel, id: string, x: number, y: number): PlantModel {
  return patchArea(model, id, { x, y });
}
