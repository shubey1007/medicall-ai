// dashboard/src/components/Docs/MarkdownRenderer.tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <article className="docs-article">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          code({ inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || "");
            if (!inline && match) {
              return (
                <SyntaxHighlighter
                  language={match[1]}
                  style={oneDark}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: "var(--radius-md)",
                    fontSize: "var(--text-sm)",
                    border: "1px solid var(--border-subtle)",
                    background: "var(--bg-elevated)",
                  }}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              );
            }
            return (
              <code
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--brand-400)",
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontSize: "0.9em",
                  fontFamily: "var(--font-mono)",
                }}
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
