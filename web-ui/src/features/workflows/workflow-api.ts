import { apiRequest } from "@/lib/api-client";

export type GraphSummary = {
  name: string;
  title: string;
  description: string;
};

export type GraphNode = {
  id: string;
  name: string;
};

export type GraphTopology = {
  nodes: GraphNode[];
  mermaid: string;
};

export function listGraphs(token?: string): Promise<GraphSummary[]> {
  return apiRequest<GraphSummary[]>("/v1/list-graphs", { token });
}

export function getGraphTopology(name: string, token?: string): Promise<GraphTopology> {
  return apiRequest<GraphTopology>(`/v1/graph_topology/${encodeURIComponent(name)}`, { token });
}
