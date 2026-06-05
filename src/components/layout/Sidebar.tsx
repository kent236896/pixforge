import {
  FileOutput,
  Maximize2,
  Crop,
  Layers,
  Zap,
  Settings,
  Moon,
  Sun,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore, type Module } from "@/store/app";

const NAV_ITEMS: { id: Module; icon: React.ElementType; label: string; labelZh: string }[] = [
  { id: "convert", icon: FileOutput, label: "Convert", labelZh: "格式转换" },
  { id: "resize", icon: Maximize2, label: "Resize", labelZh: "尺寸调整" },
  { id: "crop", icon: Crop, label: "Crop & Rotate", labelZh: "裁剪旋转" },
  { id: "batch", icon: Layers, label: "Batch", labelZh: "批量处理" },
  { id: "optimize", icon: Zap, label: "Optimize", labelZh: "压缩优化" },
];

const THEME_ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

export function Sidebar() {
  const activeModule = useAppStore(state => state.activeModule);
  const theme = useAppStore(state => state.theme);
  const setModule = useAppStore(state => state.setModule);
  const setTheme = useAppStore(state => state.setTheme);

  function cycleTheme() {
    const order = ["light", "dark", "system"] as const;
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  }

  const ThemeIcon = THEME_ICONS[theme];

  return (
    <aside className="flex flex-col w-14 shrink-0 bg-sidebar border-r border-sidebar-border">
      <nav className="flex flex-col gap-1 p-1.5 flex-1">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            title={label}
            onClick={() => setModule(id)}
            className={cn(
              "group flex flex-col items-center justify-center gap-0.5 h-12 w-full rounded-md transition-colors",
              activeModule === id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon size={18} strokeWidth={1.75} />
            <span className="text-[9px] font-medium leading-none tracking-wide">
              {label.split(" ")[0]}
            </span>
          </button>
        ))}
      </nav>

      <div className="flex flex-col gap-1 p-1.5 border-t border-sidebar-border">
        <button
          title="Theme"
          onClick={cycleTheme}
          className="flex flex-col items-center justify-center gap-0.5 h-10 w-full rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ThemeIcon size={16} strokeWidth={1.75} />
        </button>
        <button
          title="Settings"
          className="flex flex-col items-center justify-center gap-0.5 h-10 w-full rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Settings size={16} strokeWidth={1.75} />
        </button>
      </div>
    </aside>
  );
}
