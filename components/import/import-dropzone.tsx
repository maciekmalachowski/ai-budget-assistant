"use client";

import { useRef, useState, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_IMPORT_BYTES } from "@/lib/import/limits";

/** Drag-and-drop / click target that accepts a single .csv file (type-guarded). */
export function ImportDropzone({ onFile, disabled, onError }: { onFile: (file: File) => void; disabled?: boolean; onError?: (message: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      onError?.("Please choose a .csv file.");
      return;
    }
    if (f.size > MAX_IMPORT_BYTES) {
      onError?.(`File too large. Maximum ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB.`);
      return;
    }
    onFile(f);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (!disabled) handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <Upload className="size-8 text-muted-foreground" />
      <p className="text-sm font-medium">Drop a CSV here, or click to browse</p>
      <p className="text-xs text-muted-foreground">Bank statement export · max 4&nbsp;MB</p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
