"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { formatPeriodsInText } from "@/lib/dhis2-format";

interface MarkdownMessageProps {
  content: string;
  className?: string;
}

export function MarkdownMessage({ content, className }: MarkdownMessageProps) {
  // Convert raw DHIS2 period codes (e.g. "202503") into readable French
  // labels (e.g. "Mars 2025") before rendering the markdown.
  const formattedContent = formatPeriodsInText(content);

  return (
    <div className={cn("max-w-none text-sm text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children, ...props }) => (
            <div className="my-2 overflow-x-auto">
              <table
                className="w-full border-collapse text-xs"
                {...props}
              >
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted/60 font-semibold">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border border-border px-2 py-1 text-left">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1">{children}</td>
          ),
          p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="my-1 list-disc pl-4 text-xs">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 list-decimal pl-4 text-xs">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          h1: ({ children }) => <h1 className="mb-1 mt-2 text-sm font-bold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-1 mt-2 text-sm font-bold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-1 text-xs font-bold">{children}</h3>,
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
          ),
        }}
      >
        {formattedContent}
      </ReactMarkdown>
    </div>
  );
}
