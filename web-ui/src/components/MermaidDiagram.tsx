import { useEffect, useId, useState } from "react";

export function MermaidDiagram({ definition }: { definition: string }) {
  const reactId = useId();
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const renderId = `workflow-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    setSvg("");
    setFailed(false);

    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
      return mermaid.render(renderId, definition);
    }).then(({ svg: nextSvg }) => {
      if (!cancelled) setSvg(nextSvg);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [definition, reactId]);

  if (failed) {
    return <p className="text-xs text-muted-foreground">流程图暂时无法显示。</p>;
  }
  if (!svg) {
    return <p className="text-xs text-muted-foreground">正在加载流程图...</p>;
  }
  return (
    <div
      className="min-w-0 overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full"
      aria-label="工作流拓扑图"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
