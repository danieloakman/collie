import type { FeatureTab } from "@/lib/feature-tab";

// Ephemeral view memory for the in-pane Herdr tab bar. Each tab remembers which pane you last
// opened in it and which feature tab (Chat / Live / …) you were on — switching tabs restores both
// instead of always landing on the first pane in status order with Chat as the default.
const paneByTab = new Map<string, string>();
const featureByTab = new Map<string, FeatureTab>();

export function rememberPaneForTab(tabId: string, paneId: string): void {
  paneByTab.set(tabId, paneId);
}

export function paneForTab(tabId: string): string | undefined {
  return paneByTab.get(tabId);
}

export function rememberFeatureForTab(tabId: string, tab: FeatureTab): void {
  featureByTab.set(tabId, tab);
}

export function featureForTab(tabId: string): FeatureTab | undefined {
  return featureByTab.get(tabId);
}

/** Test-only — module maps must not leak across cases. */
export function __resetTabPaneMemory(): void {
  paneByTab.clear();
  featureByTab.clear();
}
