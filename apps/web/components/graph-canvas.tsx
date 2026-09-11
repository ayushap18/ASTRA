"use client";

import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { ExplainControl } from "@/components/explain-control";
import { graphElements } from "@/lib/graph-layout";
import { installAncestors, investigationHref, parseInvestigationSearch } from "@/lib/investigation";
import type { Graph, GraphPackage } from "@/lib/types";

function CustomPackageNode({ data, selected }: NodeProps) {
  const nodeData = data as {
    label: string;
    purl: string;
    direct: boolean;
    depth: number;
    blast?: "selected" | "ancestor";
    risk?: { score: number | null };
  };

  const riskScore = nodeData.risk?.score;
  const blastClass = nodeData.blast === "ancestor" ? " ancestor" : selected || nodeData.blast === "selected" ? " selected" : "";

  return (
    <div className={`graph-node-card${blastClass}`}>
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "var(--ink)", width: 6, height: 6, border: "none" }}
      />
      <span className="caption" style={{ opacity: 0.65 }}>
        d{nodeData.depth} · {nodeData.direct ? "DIRECT" : "TRANSITIVE"}
        {nodeData.blast === "ancestor" ? " · ANCESTOR" : ""}
      </span>
      <span style={{ fontSize: "15px", fontWeight: 540, letterSpacing: "-0.2px" }}>
        {nodeData.label}
      </span>
      <span className="caption">
        Risk: {riskScore != null ? riskScore : "UNKNOWN"}
      </span>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "var(--ink)", width: 6, height: 6, border: "none" }}
      />
    </div>
  );
}

export function GraphCanvas({ scanId, graph }: { scanId: string; graph: Graph }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = parseInvestigationSearch(searchParams);
  const selectedId = query.package && graph.packages.some((pkg) => pkg.id === query.package)
    ? query.package
    : null;
  const selected: GraphPackage | undefined = graph.packages.find((pkg) => pkg.id === selectedId);
  const ancestors = useMemo(
    () => (selectedId ? installAncestors(graph.edges, selectedId) : new Set<string>()),
    [graph.edges, selectedId],
  );

  const { nodes, edges } = useMemo(() => {
    const base = graphElements(graph);
    return {
      nodes: base.nodes.map((node) => ({
        ...node,
        selected: node.id === selectedId,
        data: {
          ...node.data,
          blast: node.id === selectedId ? "selected" : ancestors.has(node.id) ? "ancestor" : undefined,
        },
      })),
      edges: base.edges.map((edge) => ({
        ...edge,
        style: {
          stroke:
            selectedId && (edge.source === selectedId || edge.target === selectedId || ancestors.has(edge.source) || ancestors.has(edge.target))
              ? "var(--ink)"
              : "var(--hairline)",
          strokeWidth: selectedId && (edge.target === selectedId || edge.source === selectedId) ? 2 : 1,
        },
      })),
    };
  }, [ancestors, graph, selectedId]);

  const nodeTypes = useMemo(
    () => ({
      packageNode: CustomPackageNode,
    }),
    [],
  );

  function selectNode(id: string) {
    router.replace(investigationHref(pathname, { ...query, package: id }), { scroll: false });
  }

  return (
    <div className="stack">
      <div className="graph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_: unknown, node: Node) => selectNode(node.id)}
        >
          <Background color="#e6e6e6" gap={24} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>

      {selected ? (
        <div className="stack" style={{ background: "var(--canvas)", padding: "24px", borderRadius: "var(--radius-md)", border: "1px solid var(--hairline)" }}>
          <p className="eyebrow">Instance Inspector</p>
          <h2 className="headline">
            {selected.name}@{selected.version}
          </h2>
          <div className="stack-sm">
            <p className="caption">
              Instance ID: <strong>{selected.id}</strong>
            </p>
            <p className="caption">
              Package URL: <code>{selected.purl}</code>
            </p>
            <p className="caption">
              Topology: depth {selected.depth} · {selected.direct ? "direct declaration" : "transitive dependency"} · risk{" "}
              {selected.risk?.score ?? "unknown"}
            </p>
            <p className="caption">
              Install ancestors highlighted: {ancestors.size}. This is dependency ancestry, not an execution path.
            </p>
          </div>
          <div className="actions">
            <Link
              className="pill secondary"
              href={investigationHref(`/scans/${scanId}`, { package: selected.id, finding: query.finding })}
            >
              Open in overview
            </Link>
            <Link
              className="pill secondary"
              href={investigationHref(`/scans/${scanId}/attack`, {
                package: selected.id,
                finding: query.finding,
              })}
            >
              Simulate compromise on this instance
            </Link>
          </div>
          <ExplainControl scanId={scanId} packageId={selected.id} />
        </div>
      ) : (
        <p className="caption" style={{ padding: "8px 0" }}>
          Select any node to inspect. Multiple instances of the same package version share a purl, but have distinct instance IDs.
        </p>
      )}
    </div>
  );
}
