import {
  FileOutput,
  Maximize2,
  Crop,
  Layers,
  Zap,
  Sparkles,
  Settings,
  Moon,
  Sun,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore, type Module } from "@/store/app";
import { useT } from "@/lib/i18n";

type NavItem = { id: Module; icon: React.ElementType; labelKey: string; shortKey: string };

const NAV_ITEMS: NavItem[] = [
  { id: "convert",  icon: FileOutput, labelKey: "nav.convert",  shortKey: "nav.convert.short"  },
  { id: "resize",   icon: Maximize2,  labelKey: "nav.resize",   shortKey: "nav.resize.short"   },
  { id: "crop",     icon: Crop,       labelKey: "nav.crop",     shortKey: "nav.crop.short"     },
  { id: "batch",    icon: Layers,     labelKey: "nav.batch",    shortKey: "nav.batch.short"    },
  { id: "optimize", icon: Zap,        labelKey: "nav.optimize", shortKey: "nav.optimize.short" },
  { id: "bgeffect", icon: Sparkles,   labelKey: "nav.bgeffect", shortKey: "nav.bgeffect.short" },
];

const THEME_ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

export function Sidebar() {
  const t = useT();
  const activeModule = useAppStore(state => state.activeModule);
  const theme        = useAppStore(state => state.theme);
  const setModule    = useAppStore(state => state.setModule);
  const setTheme     = useAppStore(state => state.setTheme);

  function cycleTheme() {
    const order = ["light", "dark", "system"] as const;
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  }

  const ThemeIcon = THEME_ICONS[theme];

  return (
    <aside className="flex flex-col w-14 shrink-0 bg-sidebar border-r border-sidebar-border">
      <nav className="flex flex-col gap-1 p-1.5 flex-1">
        {NAV_ITEMS.map(({ id, icon: Icon, labelKey, shortKey }) => (
          <button
            key={id}
            aria-label={t(labelKey)}
            title={t(labelKey)}
            onClick={() => setModule(id)}
            className={cn(
              "group flex flex-col items-center justify-center gap-0.5 h-12 w-full rounded-md transition-colors",
              activeModule === id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="text-[9px] font-medium leading-none tracking-wide">
              {t(shortKey)}
            </span>
          </button>
        ))}
      </nav>

      <div className="flex flex-col gap-1 p-1.5 border-t border-sidebar-border">
        <button
          aria-label="Toggle theme"
          title="Toggle theme"
          onClick={cycleTheme}
          className="flex flex-col items-center justify-center gap-0.5 h-10 w-full rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ThemeIcon size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          aria-label={t("nav.settings")}
          title={t("nav.settings")}
          onClick={() => setModule("settings")}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 h-10 w-full rounded-md transition-colors",
            activeModule === "settings"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
