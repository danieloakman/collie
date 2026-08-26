import { FileCode2, FolderTree, MessageSquare, TerminalSquare } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  FEATURE_TABS,
  featureTabLabel,
  type FeatureTab,
} from "@/lib/feature-tab";

const ICONS: Record<FeatureTab, typeof MessageSquare> = {
  chat: MessageSquare,
  live: TerminalSquare,
  files: FolderTree,
  diffs: FileCode2,
};

interface FeatureTabStripProps {
  value: FeatureTab;
  onChange: (tab: FeatureTab) => void;
}

/** Mobile feature tabs under the Herdr tab/pane strips — Chat / Live / Files / Diffs. */
export function FeatureTabStrip({ value, onChange }: FeatureTabStripProps) {
  return (
    <div
      role="tablist"
      aria-label="Pane views"
      className="flex shrink-0 gap-1 overflow-x-auto border-t border-border/40 px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {FEATURE_TABS.map((tab) => {
        const Icon = ICONS[tab];
        const active = tab === value;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground active:bg-muted/50",
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            {featureTabLabel(tab)}
          </button>
        );
      })}
    </div>
  );
}
