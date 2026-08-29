import {
  __resetTabPaneMemory,
  featureForTab,
  paneForTab,
  rememberFeatureForTab,
  rememberPaneForTab,
} from "./tab-pane-memory";

describe("tab-pane-memory", () => {
  afterEach(() => __resetTabPaneMemory());

  it("remembers the last pane and feature tab per Herdr tab", () => {
    rememberPaneForTab("w1:t1", "w1:p1");
    rememberPaneForTab("w1:t2", "w1:p9");
    rememberFeatureForTab("w1:t1", "live");
    rememberFeatureForTab("w1:t2", "chat");

    expect(paneForTab("w1:t1")).toBe("w1:p1");
    expect(paneForTab("w1:t2")).toBe("w1:p9");
    expect(featureForTab("w1:t1")).toBe("live");
    expect(featureForTab("w1:t2")).toBe("chat");
  });
});
