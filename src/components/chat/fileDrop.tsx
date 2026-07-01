"use client";
import React, { useRef, useState } from "react";
import { Icon } from "@/components/Icon";

/** Shared drag-and-drop file handling for both chats (clients + team). Spread `dragProps` on the
 *  chat container (must be position:relative) and render <DropOverlay/> when `dragOver` is true. */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [dragOver, setDragOver] = useState(false);
  const depth = useRef(0); // dragenter/leave fire on children too — count depth to know when we truly left
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  const dragProps = {
    onDragEnter: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current += 1; setDragOver(true); },
    onDragOver: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
    onDragLeave: (e: React.DragEvent) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDragOver(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); depth.current = 0; setDragOver(false); const files = Array.from(e.dataTransfer.files); if (files.length) onFiles(files); },
  };
  return { dragOver, dragProps };
}

export function DropOverlay({ lang }: { lang: "es" | "en" }) {
  return (
    <div className="drop-overlay">
      <div className="drop-inner">
        <span className="drop-ic"><Icon name="paperclip" size={26} /></span>
        <div style={{ fontWeight: 700, fontSize: 15, marginTop: 10 }}>{lang === "es" ? "Suelta los archivos para adjuntar" : "Drop files to attach"}</div>
      </div>
    </div>
  );
}
