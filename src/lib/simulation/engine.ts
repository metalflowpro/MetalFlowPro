import { ProcessNode, StreamEdge, FeedInput, StreamResult, NodeResult, GlobalResults, UnitOutput } from './types';
import { getUnit } from './unitRegistry';
import { DEFAULT_ASSUMPTIONS, FEED_STREAM_DEFAULTS } from '../config/constants';

// ─── Topological sort (Kahn's algorithm) ─────────────────────────────────────

export function topologicalSort(nodes: ProcessNode[], edges: StreamEdge[]): ProcessNode[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adjacency.set(n.id, []);
  }

  for (const e of edges) {
    adjacency.get(e.source_node_id)?.push(e.target_node_id);
    inDegree.set(e.target_node_id, (inDegree.get(e.target_node_id) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: ProcessNode[] = [];
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);
    for (const neighbour of adjacency.get(id) ?? []) {
      const newDeg = (inDegree.get(neighbour) ?? 1) - 1;
      inDegree.set(neighbour, newDeg);
      if (newDeg === 0) queue.push(neighbour);
    }
  }

  // If not all nodes included, there are cycles — append remaining in original order
  if (sorted.length < nodes.length) {
    const sortedIds = new Set(sorted.map(n => n.id));
    for (const n of nodes) {
      if (!sortedIds.has(n.id)) sorted.push(n);
    }
  }

  return sorted;
}

// ─── Detect recycle edges (edges that form back-arcs in the DAG) ──────────────

export function detectRecycleEdges(nodes: ProcessNode[], edges: StreamEdge[]): Set<string> {
  const sorted = topologicalSort(nodes, edges);
  const order = new Map(sorted.map((n, i) => [n.id, i]));
  const recycleIds = new Set<string>();
  for (const e of edges) {
    const srcOrder = order.get(e.source_node_id) ?? 0;
    const tgtOrder = order.get(e.target_node_id) ?? 0;
    if (srcOrder >= tgtOrder) recycleIds.add(e.id);
  }
  return recycleIds;
}

// ─── Stream map helpers ───────────────────────────────────────────────────────

function emptyStream(edgeId: string): StreamResult {
  return {
    edge_id: edgeId,
    mass_flow: 0, volume_flow: 0, solids_content: 0,
    gold_grade: 0, gold_flow: 0, dissolved_gold: 0,
    cyanide_concentration: 0, pH: 7, temperature: 25,
  };
}

/**
 * Opérations dont l'énergie dépend de la dureté du minerai (équation de Bond).
 * Elles doivent hériter du BWi déclaré à l'alimentation ROM plutôt que d'un
 * défaut générique, sans quoi la simulation prédit la même consommation pour
 * un minerai tendre et pour un minerai dur.
 */
const COMMINUTION_UNITS = new Set([
  'hpgr', 'sag_mill', 'ag_mill', 'ball_mill', 'rod_mill', 'vertical_mill',
]);

/**
 * Paramètres effectifs d'un nœud : ses propres réglages, complétés par le BWi
 * de l'alimentation quand l'utilisateur ne l'a pas fixé sur le broyeur. Un
 * réglage explicite au nœud reste prioritaire — le minerai donne la valeur par
 * défaut, l'ingénieur garde la main.
 */
export function effectiveParams(
  node: { unit_type: string; parameters: Record<string, number | string> },
  feed: FeedInput,
): Record<string, number | string> {
  if (!COMMINUTION_UNITS.has(node.unit_type)) return node.parameters;
  const own = node.parameters?.bwi;
  const hasOwn = own !== undefined && own !== '' && Number.isFinite(Number(own));
  if (hasOwn) return node.parameters;
  if (!Number.isFinite(feed?.hardness_bwi) || feed.hardness_bwi <= 0) return node.parameters;
  return { ...node.parameters, bwi: feed.hardness_bwi };
}

function feedToStream(edgeId: string, feed: FeedInput): StreamResult {
  const dryRate = feed.feed_rate * (1 - feed.moisture / 100);
  return {
    edge_id: edgeId,
    mass_flow: dryRate,
    volume_flow: dryRate / DEFAULT_ASSUMPTIONS.DEFAULT_ORE_SG_T_M3,
    solids_content: 100 - feed.moisture,
    gold_grade: feed.gold_grade,
    gold_flow: (dryRate * feed.gold_grade) / 1000,
    dissolved_gold: 0,
    cyanide_concentration: 0,
    pH: FEED_STREAM_DEFAULTS.pH,
    temperature: FEED_STREAM_DEFAULTS.temperatureC,
  };
}

// ─── Core solver ──────────────────────────────────────────────────────────────

/** Convert dissolved concentration and solution flow to contained gold flow. */
export function dissolvedGoldKgH(concentrationMgL: number, volumeM3H: number): number {
  return concentrationMgL * volumeM3H / 1000;
}

/** Maximum relative change across dry mass, water volume and gold inventories. */
export function streamConvergenceError(
  previous: Record<string, StreamResult>,
  current: Record<string, StreamResult>,
): number {
  let maxErr = 0;
  for (const edgeId of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    const prev = previous[edgeId] ?? emptyStream(edgeId);
    const curr = current[edgeId] ?? emptyStream(edgeId);
    const quantities = [
      [prev.mass_flow, curr.mass_flow],
      [prev.volume_flow, curr.volume_flow],
      [prev.gold_flow, curr.gold_flow],
      [dissolvedGoldKgH(prev.dissolved_gold, prev.volume_flow), dissolvedGoldKgH(curr.dissolved_gold, curr.volume_flow)],
    ];
    for (const [a, b] of quantities) {
      const denom = Math.max(Math.abs(a), Math.abs(b), 1e-10);
      maxErr = Math.max(maxErr, Math.abs(b - a) / denom);
    }
  }
  return maxErr;
}

export interface SolveOptions {
  maxIterations: number;
  tolerance: number;     // fractional convergence criterion on gold_flow
  mode: 'steady_state' | 'dynamic';
}

export interface SolveResult {
  streams: Record<string, StreamResult>;
  nodeResults: Record<string, NodeResult>;
  globalResults: GlobalResults;
  iterations: number;
  convergenceError: number;
  status: 'converged' | 'diverged' | 'completed';
}

export function solveFlowsheet(
  nodes: ProcessNode[],
  edges: StreamEdge[],
  feed: FeedInput,
  options: SolveOptions = { maxIterations: 100, tolerance: 1e-4, mode: 'steady_state' },
): SolveResult {
  const sorted = topologicalSort(nodes, edges);
  const recycleEdgeIds = detectRecycleEdges(nodes, edges);

  // Initialise stream map — recycle streams start at zero, feed streams from feed input
  const streams: Record<string, StreamResult> = {};
  for (const e of edges) {
    streams[e.id] = emptyStream(e.id);
  }

  // Feed source edges get actual feed values
  for (const e of edges) {
    const srcNode = nodes.find(n => n.id === e.source_node_id);
    if (srcNode?.unit_type === 'feed_source') {
      streams[e.id] = feedToStream(e.id, feed);
    }
  }

  const nodeResults: Record<string, NodeResult> = {};
  let iterations = 0;
  let convergenceError = Infinity;
  let status: SolveResult['status'] = 'completed';

  while (iterations < options.maxIterations) {
    const prevStreams = JSON.parse(JSON.stringify(streams)) as Record<string, StreamResult>;

    for (const node of sorted) {
      const unit = getUnit(node.unit_type);
      if (!unit) continue;

      // Gather input streams (exclude recycle edges on first pass if not yet set)
      const inEdges = edges.filter(e => e.target_node_id === node.id);
      const outEdges = edges.filter(e => e.source_node_id === node.id);

      const inputStreams: StreamResult[] = inEdges.map(e => streams[e.id] ?? emptyStream(e.id));

      // Feed source gets feed directly
      let output: UnitOutput;
      if (node.unit_type === 'feed_source') {
        const feedStream = feedToStream('feed', feed);
        output = unit.calculate([feedStream], node.parameters, node.design_capacity);
      } else {
        output = unit.calculate(inputStreams, effectiveParams(node, feed), node.design_capacity);
      }

      // Assign output streams
      for (let i = 0; i < outEdges.length; i++) {
        const edge = outEdges[i];
        const outStream = output.outStreams[i] ?? output.outStreams[0];
        if (outStream) {
          streams[edge.id] = {
            edge_id: edge.id,
            mass_flow: outStream.mass_flow ?? 0,
            volume_flow: outStream.volume_flow ?? 0,
            solids_content: outStream.solids_content ?? 0,
            gold_grade: outStream.gold_grade ?? 0,
            gold_flow: outStream.gold_flow ?? 0,
            dissolved_gold: outStream.dissolved_gold ?? 0,
            cyanide_concentration: outStream.cyanide_concentration ?? 0,
            pH: outStream.pH ?? 7,
            temperature: outStream.temperature ?? 25,
          };
        }
      }

      nodeResults[node.id] = {
        node_id: node.id,
        feed_rate: inputStreams.reduce((s, r) => s + r.mass_flow, 0),
        product_rate: output.nodeResult.product_rate ?? 0,
        recovery: output.nodeResult.recovery ?? 0,
        energy_consumption: output.nodeResult.energy_consumption ?? 0,
        reagent_consumptions: output.nodeResult.reagent_consumptions ?? {},
        utilization_rate: output.nodeResult.utilization_rate ?? 0,
        is_bottleneck: false,
        kpis: output.nodeResult.kpis ?? {},
      };
    }

    // Convergence requires simultaneous closure of dry mass, water and gold.
    const maxErr = streamConvergenceError(prevStreams, streams);

    iterations++;
    convergenceError = maxErr;

    if (maxErr < options.tolerance && recycleEdgeIds.size === 0) {
      status = 'converged';
      break;
    }
    if (maxErr < options.tolerance && iterations >= 3) {
      status = 'converged';
      break;
    }
    if (iterations >= options.maxIterations) {
      status = convergenceError < 0.01 ? 'converged' : 'diverged';
    }
  }

  const globalResults = computeGlobalResults(nodes, edges, streams, nodeResults, feed);

  // Mark bottleneck
  let maxUtil = 0;
  let bottleneckId: string | null = null;
  for (const [id, r] of Object.entries(nodeResults)) {
    if (r.utilization_rate > maxUtil) {
      maxUtil = r.utilization_rate;
      bottleneckId = id;
    }
  }
  if (bottleneckId) nodeResults[bottleneckId].is_bottleneck = true;
  globalResults.bottleneck_node_id = bottleneckId;

  return { streams, nodeResults, globalResults, iterations, convergenceError, status };
}

// ─── Global results aggregation ───────────────────────────────────────────────

function computeGlobalResults(
  nodes: ProcessNode[],
  edges: StreamEdge[],
  streams: Record<string, StreamResult>,
  nodeResults: Record<string, NodeResult>,
  feed: FeedInput,
): GlobalResults {
  // Find sink streams (edges whose target is a product_sink or has no outgoing edges)
  const sinkNodeIds = new Set(nodes.filter(n => n.unit_type === 'product_sink').map(n => n.id));
  const nodesWithOutgoing = new Set(edges.map(e => e.source_node_id));
  for (const n of nodes) {
    if (!nodesWithOutgoing.has(n.id)) sinkNodeIds.add(n.id);
  }

  // Gold in feed
  const feedGoldFlow = (feed.feed_rate * (1 - feed.moisture / 100) * feed.gold_grade) / 1000; // kg/h

  // Gold recovered = sum of gold_flow into product sinks
  let goldRecovered = 0;
  let tailsGoldFlow = 0;
  let doReFlow = 0;
  let cnInTails = 0;

  for (const e of edges) {
    if (sinkNodeIds.has(e.target_node_id)) {
      const s = streams[e.id];
      if (!s) continue;
      if (e.stream_type === 'solid') tailsGoldFlow += s.gold_flow;
      else goldRecovered += s.gold_flow + dissolvedGoldKgH(s.dissolved_gold ?? 0, s.volume_flow);
    }
    // CN in tailings — last stream going to tails
    const tgtNode = nodes.find(n => n.id === e.target_node_id);
    if (tgtNode && (tgtNode.unit_type === 'product_sink' || !nodesWithOutgoing.has(tgtNode.id))) {
      const s = streams[e.id];
      if (s && e.stream_type !== 'solution') cnInTails = Math.max(cnInTails, s.cyanide_concentration ?? 0);
    }
  }

  // Electrowinning output → doré
  for (const n of nodes) {
    if (n.unit_type === 'electrowinning') {
      const nr = nodeResults[n.id];
      doReFlow += (nr?.kpis?.gold_deposited_kg_h ?? 0);
    }
  }
  if (doReFlow === 0) doReFlow = goldRecovered;

  const overallRecovery = feedGoldFlow > 0 ? Math.min(99, (goldRecovered / feedGoldFlow) * 100) : 0;

  // Tails grade
  const tailsMassFlow = Object.values(streams).filter(s => s.solids_content > 0).slice(-1)[0]?.mass_flow ?? feed.feed_rate;
  const tailsGrade = tailsMassFlow > 0 ? (tailsGoldFlow / tailsMassFlow) * 1000 : 0;

  // Energy and reagent totals
  let totalEnergyKwhH = 0;
  let cyanideKgH = 0;
  let limeKgH = 0;

  for (const nr of Object.values(nodeResults)) {
    const nodeFeedTph = nr.feed_rate ?? 0;
    totalEnergyKwhH += (nr.energy_consumption ?? 0) * nodeFeedTph;
    for (const [name, dosageKgT] of Object.entries(nr.reagent_consumptions ?? {})) {
      const key = name.toLowerCase();
      if (key.includes('cyanide') || key.includes('nacn')) cyanideKgH += dosageKgT * nodeFeedTph;
      if (key.includes('lime') || key.includes('cao')) limeKgH += dosageKgT * nodeFeedTph;
    }
  }

  const feedRate = feed.feed_rate * (1 - feed.moisture / 100) || 1;
  const totalEnergy = totalEnergyKwhH / feedRate;
  const cyanideConsumption = cyanideKgH / feedRate;
  const limeConsumption = limeKgH / feedRate;
  const totalOpex = totalEnergy * 0.12 + cyanideConsumption * 2.5 + limeConsumption * 0.12;

  const capacityUtilization: Record<string, number> = {};
  for (const [id, nr] of Object.entries(nodeResults)) {
    capacityUtilization[id] = nr.utilization_rate;
  }

  return {
    overall_recovery: overallRecovery,
    dore_production_kg_h: doReFlow,
    total_opex_per_t: totalOpex,
    total_energy_kwh_t: totalEnergy,
    cyanide_consumption: cyanideConsumption,
    lime_consumption: limeConsumption,
    tails_grade: tailsGrade,
    cn_in_tailings: cnInTails,
    bottleneck_node_id: null,
    capacity_utilization: capacityUtilization,
  };
}

// ─── Bottleneck analysis ──────────────────────────────────────────────────────

export function analyzeBottlenecks(
  nodes: ProcessNode[],
  nodeResults: Record<string, NodeResult>,
): { node_id: string; utilization_pct: number; is_bottleneck: boolean; severity: 'ok' | 'warning' | 'critical'; recommended_action: string }[] {
  return nodes.map(node => {
    const nr = nodeResults[node.id];
    const util = nr?.utilization_rate ?? 0;
    const severity: 'ok' | 'warning' | 'critical' = util >= 95 ? 'critical' : util >= 80 ? 'warning' : 'ok';
    let action = 'No action required';
    if (severity === 'critical') action = `Upsize ${node.label} or add parallel unit`;
    else if (severity === 'warning') action = `Monitor ${node.label} throughput`;
    return {
      node_id: node.id,
      utilization_pct: util,
      is_bottleneck: nr?.is_bottleneck ?? false,
      severity,
      recommended_action: action,
    };
  });
}
