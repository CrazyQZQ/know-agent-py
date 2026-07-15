import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "@/features/auth/AuthProvider";
import { listGraphs, type GraphSummary } from "@/features/workflows/workflow-api";
import { ApiError } from "@/lib/api-client";

function graphErrorMessage(error: unknown): string {
  return error instanceof ApiError && error.status === 404
    ? "工作流不存在或已下线"
    : "工作流列表加载失败，请稍后重试。";
}

export function WorkflowsPage() {
  const { auth } = useAuth();
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void listGraphs(auth?.token).then(
      (items) => {
        if (!cancelled) setGraphs(items);
      },
      (reason) => {
        if (!cancelled) setError(graphErrorMessage(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [auth?.token]);

  return (
    <section className="p-5">
      <h1 className="mb-4 text-2xl font-semibold">工作流</h1>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!error && graphs.length === 0 ? (
        <p className="text-sm text-muted-foreground">正在加载工作流...</p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {graphs.map((graph) => (
          <article key={graph.name} className="rounded-lg border border-border p-4">
            <h2 className="font-medium">{graph.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{graph.description}</p>
            <Link
              className="mt-3 inline-flex rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              to={`/workflows/${graph.name}`}
            >
              运行 {graph.title}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
