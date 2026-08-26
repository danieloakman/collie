// Feature tabs on the pane detail screen: Chat (default) / Live / Files / Diffs.
// Carried in `?tab=` alongside the existing `?s=` session param.

export const FEATURE_TABS = ["chat", "live", "files", "diffs"] as const;
export type FeatureTab = (typeof FEATURE_TABS)[number];

export const FEATURE_TAB_PARAM = "tab";

export function parseFeatureTab(raw: string | null | undefined): FeatureTab {
  const t = raw?.trim().toLowerCase();
  return (FEATURE_TABS as readonly string[]).includes(t ?? "") ? (t as FeatureTab) : "chat";
}

/** Merge tab into an existing search string (`""` / `?s=…`), keeping session. */
export function withFeatureTab(search: string, tab: FeatureTab): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (tab === "chat") params.delete(FEATURE_TAB_PARAM);
  else params.set(FEATURE_TAB_PARAM, tab);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function featureTabLabel(tab: FeatureTab): string {
  switch (tab) {
    case "chat":
      return "Chat";
    case "live":
      return "Live";
    case "files":
      return "Files";
    case "diffs":
      return "Diffs";
  }
}
