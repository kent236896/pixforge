import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function Titlebar() {
  const win = getCurrentWindow();

  return (
    <div className="flex h-9 select-none bg-background border-b border-border shrink-0">
      {/* Drag region — fills leftmost space, must NOT wrap the buttons */}
      <div
        data-tauri-drag-region
        className="flex flex-1 items-center gap-2 pl-3 overflow-hidden cursor-default"
      >
        <div className="w-3.5 h-3.5 rounded-sm bg-primary opacity-90 shrink-0 pointer-events-none" />
        <span className="text-xs font-semibold tracking-tight text-foreground pointer-events-none truncate">
          PixForge
        </span>
      </div>

      {/* Window controls — completely separate from drag region */}
      <div className="flex items-center shrink-0">
        <button
          onClick={() => win.minimize()}
          className="flex h-9 w-10 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Minimize"
        >
          <Minus size={13} />
        </button>
        <button
          onClick={() => win.toggleMaximize()}
          className="flex h-9 w-10 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Maximize"
        >
          <Square size={12} />
        </button>
        <button
          onClick={() => win.close()}
          className="flex h-9 w-10 items-center justify-center text-muted-foreground hover:bg-destructive hover:text-white transition-colors"
          aria-label="Close"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
