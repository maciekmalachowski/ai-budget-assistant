"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";

interface AskResponse {
  answer: string;
  toolCalls: { name: string; input: unknown }[];
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Floating "Ask AI" button + slide-over panel. Opens on the "/" key (unless typing) and closes on Escape. */
export function AskPanel() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && !open && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  const submit = useCallback(async () => {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = (await res.json()) as AskResponse | { error: string };
      if (!res.ok || "error" in data) {
        setError(("error" in data && data.error) || "Something went wrong.");
      } else {
        setAnswer(data.answer);
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [question, loading]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-foreground text-background fixed right-6 bottom-6 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-sm shadow-lg hover:opacity-90"
        aria-label="Ask AI"
      >
        <Sparkles className="size-4" />
        Ask AI
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Ask AI">
          <div className="flex-1 bg-black/30" onClick={() => setOpen(false)} />
          <div className="bg-background flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Ask about your money</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              className="flex flex-col gap-2"
            >
              <textarea
                ref={textareaRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder="e.g. How much did I spend on groceries last month?"
                rows={3}
                className="focus:ring-ring w-full rounded-md border bg-background p-3 text-sm focus:ring-2 focus:outline-none"
              />
              <button
                type="submit"
                disabled={loading || !question.trim()}
                className="bg-foreground text-background self-end rounded-md px-4 py-2 text-sm disabled:opacity-50"
              >
                {loading ? "Thinking…" : "Ask"}
              </button>
            </form>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            {answer ? (
              <div className="bg-muted/30 rounded-md border p-4">
                <Markdown>{answer}</Markdown>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
