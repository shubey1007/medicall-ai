// dashboard/src/components/Docs/MarkdownRenderer.tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <article className="prose prose-slate max-w-none prose-headings:scroll-mt-24 prose-pre:p-0 prose-pre:bg-transparent prose-pre:border-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || "");
            if (!inline && match) {
              return (
                <SyntaxHighlighter
                  language={match[1]}
                  style={oneLight}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: "0.5rem",
                    fontSize: "0.85rem",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              );
            }
            return (
              <code
                className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono"
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
