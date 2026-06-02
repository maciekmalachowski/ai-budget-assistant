import ReactMarkdown from "react-markdown";

/**
 * Dependency-light Markdown renderer for AI answers and insight summaries.
 * We don't use @tailwindcss/typography, so each element is styled with our own
 * Tailwind utilities. react-markdown does not render raw HTML by default, so this
 * is safe to feed model output into.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          h1: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
          h3: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
          a: ({ href, children }) => (
            <a href={href} className="text-blue-400 underline" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          code: ({ children }) => <code className="bg-muted rounded px-1 py-0.5 text-xs">{children}</code>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
