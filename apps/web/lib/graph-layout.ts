import type { Graph } from "./types.ts";

export function graphElements(graph: Graph) {
  const ids = new Set(graph.packages.map((pkg) => pkg.id));
  const columns = new Map<number, number>();
  const nodes = graph.packages.map((pkg) => {
    const column = columns.get(pkg.depth) ?? 0;
    columns.set(pkg.depth, column + 1);
    return {
      id: pkg.id,
      type: "packageNode",
      position: { x: column * 280, y: pkg.depth * 140 },
      data: {
        label: `${pkg.name}@${pkg.version}`,
        purl: pkg.purl,
        direct: pkg.direct,
        depth: pkg.depth,
        risk: pkg.risk,
      },
    };
  });
  const edges = graph.edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => ({
      id: `${edge.source}->${edge.target}`,
      source: edge.source,
      target: edge.target,
      data: { scope: edge.scope },
    }));
  return { nodes, edges };
}
