import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { cn } from "@/lib/utils";

import "katex/dist/katex.min.css";

interface MarkdownTextProps {
  children: string;
  className?: string;
  streaming?: boolean;
}

export function MarkdownText({ children, className }: MarkdownTextProps) {
  return (
    <div
      className={cn(
        "markdown-content prose max-w-none break-words dark:prose-invert",
        "prose-headings:mb-2 prose-headings:mt-4 prose-headings:font-semibold",
        "prose-p:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-li:leading-6",
        "prose-pre:my-3 prose-pre:overflow-x-auto prose-pre:rounded-md",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-a:text-blue-600 prose-a:underline prose-a:underline-offset-2",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkBreaks, remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children: linkChildren }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {linkChildren}
            </a>
          ),
          table: ({ children: tableChildren, ...props }) => (
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-max" {...props}>
                {tableChildren}
              </table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
