/**
 * Pure Dependency Graph Engine (Plan Studio / Blueprint Engine).
 * Kahn's topological sort algorithm with longest-path level calculation,
 * cycle detection, critical path extraction, and blocked/ready task resolution.
 */

export interface GraphNode {
  ref: string;
  status: string;
  effortHours: number;
  dependsOn: string | null;
}

export interface DepGraph {
  levels: string[][];
  cycles: string[][];
  criticalPath: string[];
  criticalEffort: number;
  edges: { from: string; to: string }[];
  blocked: { ref: string; blockedBy: string[] }[];
  ready: string[];
  unresolvable: { ref: string; missing: string[] }[];
}

const REF_PATTERN = /^[A-Z0-9_-]+$/i;

/** "A1, B2" -> ["A1", "B2"] deduplicated */
export function parseRefs(value: string | null | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[,\s]+/)) {
    const ref = part.trim().toUpperCase();
    if (REF_PATTERN.test(ref) && !seen.has(ref)) {
      seen.add(ref);
      out.push(ref);
    }
  }
  return out;
}

export function buildGraph(nodes: GraphNode[]): DepGraph {
  const byRef = new Map<string, GraphNode>();
  for (const node of nodes) byRef.set(node.ref.toUpperCase(), node);

  const edges: { from: string; to: string }[] = [];
  const deps = new Map<string, string[]>();
  const unresolvable: { ref: string; missing: string[] }[] = [];

  for (const node of nodes) {
    const ref = node.ref.toUpperCase();
    const requested = parseRefs(node.dependsOn).filter(dep => dep !== ref);
    const resolvable: string[] = [];
    const missing: string[] = [];
    for (const dep of requested) {
      if (byRef.has(dep)) {
        resolvable.push(dep);
        edges.push({ from: dep, to: ref });
      } else {
        missing.push(dep);
      }
    }
    deps.set(ref, resolvable);
    if (missing.length > 0) unresolvable.push({ ref, missing });
  }

  // Kahn's algorithm, tracking longest-path depth
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const ref of byRef.keys()) {
    inDegree.set(ref, 0);
    dependents.set(ref, []);
  }

  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    dependents.get(edge.from)?.push(edge.to);
  }

  const queue: string[] = [];
  const depth = new Map<string, number>();
  for (const [ref, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(ref);
      depth.set(ref, 0);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    const currentDepth = depth.get(current) ?? 0;

    for (const dep of dependents.get(current) ?? []) {
      const nextDegree = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, nextDegree);
      depth.set(dep, Math.max(depth.get(dep) ?? 0, currentDepth + 1));
      if (nextDegree === 0) {
        queue.push(dep);
      }
    }
  }

  // Level grouping
  const maxDepth = depth.size > 0 ? Math.max(...depth.values()) : -1;
  const levels: string[][] = [];
  for (let i = 0; i <= maxDepth; i++) {
    levels.push([]);
  }
  for (const [ref, d] of depth.entries()) {
    levels[d]?.push(ref);
  }

  // Cycles detection
  const cycles: string[][] = [];
  if (sorted.length < byRef.size) {
    const unvisited = new Set(byRef.keys());
    for (const ref of sorted) unvisited.delete(ref);
    cycles.push(Array.from(unvisited));
  }

  // Ready & Blocked states
  const ready: string[] = [];
  const blocked: { ref: string; blockedBy: string[] }[] = [];
  for (const node of nodes) {
    const ref = node.ref.toUpperCase();
    const nodeDeps = deps.get(ref) ?? [];
    const pendingDeps = nodeDeps.filter(d => {
      const parent = byRef.get(d);
      return parent && parent.status !== 'done' && parent.status !== 'completed';
    });

    if (node.status === 'done' || node.status === 'completed') {
      continue;
    }

    if (pendingDeps.length === 0) {
      ready.push(ref);
    } else {
      blocked.push({ ref, blockedBy: pendingDeps });
    }
  }

  // Critical path calculation (longest weighted path)
  let criticalPath: string[] = [];
  let criticalEffort = 0;

  function findLongestPath(curr: string, visited: Set<string>): { path: string[]; effort: number } {
    visited.add(curr);
    const currNode = byRef.get(curr);
    const currEffort = currNode?.effortHours ?? 0;
    const children = dependents.get(curr) ?? [];

    let bestChildPath: string[] = [];
    let bestChildEffort = 0;

    for (const child of children) {
      if (!visited.has(child)) {
        const res = findLongestPath(child, new Set(visited));
        if (res.effort > bestChildEffort) {
          bestChildEffort = res.effort;
          bestChildPath = res.path;
        }
      }
    }

    return {
      path: [curr, ...bestChildPath],
      effort: currEffort + bestChildEffort,
    };
  }

  for (const ref of byRef.keys()) {
    if ((inDegree.get(ref) ?? 0) === 0) {
      const res = findLongestPath(ref, new Set());
      if (res.effort > criticalEffort) {
        criticalEffort = res.effort;
        criticalPath = res.path;
      }
    }
  }

  return {
    levels,
    cycles,
    criticalPath,
    criticalEffort,
    edges,
    blocked,
    ready,
    unresolvable,
  };
}
