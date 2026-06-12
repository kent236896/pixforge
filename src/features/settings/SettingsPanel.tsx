import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Moon, Sun, Monitor, Globe, Info } from "lucide-react";
import { useAppStore, type Theme } from "@/store/app";
import { useT, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import appIcon from "@/assets/app-icon.png";

const THEME_OPTIONS: { value: Theme; icon: React.ElementType; key: string }[] = [
  { value: "light",  icon: Sun,     key: "settings.themeLight"  },
  { value: "dark",   icon: Moon,    key: "settings.themeDark"   },
  { value: "system", icon: Monitor, key: "settings.themeSystem" },
];

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      {children}
    </div>
  );
}

function SectionLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon size={14} strokeWidth={1.75} className="text-muted-foreground" />
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

export function SettingsPanel() {
  const t = useT();
  const theme  = useAppStore(state => state.theme);
  const locale = useAppStore(state => state.locale);
  const setTheme  = useAppStore(state => state.setTheme);
  const setLocale = useAppStore(state => state.setLocale);
  const [version, setVersion] = useState<string>("…");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("—"));
  }, []);

  const LOCALES: { value: Locale; label: string }[] = [
    { value: "en", label: t("settings.langEn") },
    { value: "zh", label: t("settings.langZh") },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <h1 className="mb-6 text-base font-semibold">{t("settings.title")}</h1>

      <div className="mx-auto w-full max-w-sm space-y-4">
        {/* ── Language ─────────────────────────────────────────────── */}
        <SectionCard>
          <SectionLabel icon={Globe} label={t("settings.language")} />
          <div className="flex gap-2">
            {LOCALES.map(l => (
              <button
                key={l.value}
                type="button"
                onClick={() => setLocale(l.value)}
                className={cn(
                  "flex flex-1 items-center justify-center rounded-lg border py-2 text-sm font-medium transition-colors",
                  locale === l.value
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </SectionCard>

        {/* ── Theme ────────────────────────────────────────────────── */}
        <SectionCard>
          <SectionLabel icon={Sun} label={t("settings.theme")} />
          <div className="flex gap-2">
            {THEME_OPTIONS.map(opt => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme(opt.value)}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-1.5 rounded-lg border py-2.5 text-xs font-medium transition-colors",
                    theme === opt.value
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  )}
                >
                  <Icon size={15} strokeWidth={1.75} />
                  {t(opt.key)}
                </button>
              );
            })}
          </div>
        </SectionCard>

        {/* ── About ────────────────────────────────────────────────── */}
        <SectionCard>
          <SectionLabel icon={Info} label={t("settings.about")} />
          <div className="flex items-start gap-4">
            <img
              src={appIcon}
              alt="PixForge"
              className="h-12 w-12 shrink-0 rounded-xl shadow-sm select-none"
            />
            <div className="min-w-0">
              <p className="font-semibold text-foreground">PixForge</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.description")}</p>
              <p className="mt-2 text-[11px] text-muted-foreground/70">
                {t("settings.version")} {version}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                {t("settings.builtWith")}
              </p>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
