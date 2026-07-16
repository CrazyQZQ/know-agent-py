import { useEffect, useRef, useState } from "react";
import { Bubble } from "@ant-design/x";
import { Check, Copy } from "lucide-react";

import { copyTextToClipboard } from "@/lib/clipboard";
import { formatClock } from "@/lib/format";
import { MarkdownText } from "@/components/MarkdownText";

export interface ChatMessageRowProps {
  role: "user" | "assistant";
  content: string;
  createdAt: Date | string | number;
  isStreaming?: boolean;
}

export function ChatMessageRow({ role, content, createdAt, isStreaming = false }: ChatMessageRowProps) {
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetRef.current !== null) window.clearTimeout(resetRef.current);
  }, []);

  async function copyMessage() {
    if (!(await copyTextToClipboard(content))) return;
    setCopied(true);
    if (resetRef.current !== null) window.clearTimeout(resetRef.current);
    resetRef.current = window.setTimeout(() => setCopied(false), 1_500);
  }

  const isUser = role === "user";
  const showTyping = !isUser && isStreaming && !content;

  return (
    <Bubble
      placement={isUser ? "end" : "start"}
      variant={isUser ? "filled" : "borderless"}
      shape="default"
      footerPlacement="outer-end"
      styles={{ footer: { marginTop: 4, flexDirection: "row", justifyContent: isUser ? "flex-end" : "flex-start" } }}
      content={content}
      loading={showTyping}
      loadingRender={() => (
        <span aria-label="Assistant typing" className="inline-flex items-center gap-1 py-1">
          {[0, 1, 2].map((index) => (
            <span key={index} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 motion-reduce:animate-none" style={{ animationDelay: `${index * 150}ms` }} />
          ))}
        </span>
      )}
      contentRender={(c) => (isUser ? c : <MarkdownText streaming={isStreaming}>{c as string}</MarkdownText>)}
      footer={
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <time dateTime={new Date(createdAt).toISOString()}>{formatClock(createdAt)}</time>
          <button
            type="button"
            aria-label={copied ? "Copied" : "Copy message"}
            title={copied ? "Copied" : "Copy message"}
            onClick={() => void copyMessage()}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-muted"
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </div>
      }
    />
  );
}
