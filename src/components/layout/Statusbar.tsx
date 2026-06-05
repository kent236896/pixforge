import { useAppStore } from "@/store/app";
import { formatBytes } from "@/lib/invoke";

export function Statusbar() {
  const currentImage = useAppStore(state => state.currentImage);

  return (
    <div className="flex h-6 items-center justify-between border-t border-border bg-background px-3 shrink-0">
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
        {currentImage ? (
          <>
            <span>{currentImage.format}</span>
            <span className="opacity-40">·</span>
            <span>{currentImage.width} × {currentImage.height}</span>
            <span className="opacity-40">·</span>
            <span>{formatBytes(currentImage.file_size)}</span>
            {currentImage.bit_depth > 0 && (
              <>
                <span className="opacity-40">·</span>
                <span>{currentImage.color_space} {currentImage.bit_depth}-bit</span>
              </>
            )}
          </>
        ) : (
          <span>Ready</span>
        )}
      </div>
    </div>
  );
}
