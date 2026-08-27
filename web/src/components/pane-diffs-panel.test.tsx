import { act, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { PaneDiffsPanel } from "@/components/pane-diffs-panel";
import { VISIBLE_POLL_MS } from "@/hooks/use-visible-interval";
import { resetIdleLock } from "@/lib/idle";
import { server } from "@/test/setup";

describe("PaneDiffsPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetIdleLock();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetIdleLock();
  });

  test("refreshes the status list on the visible poll interval", async () => {
    let calls = 0;
    server.use(
      http.get("/api/pane/:paneId/git/status", () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({
            paneId: "p1",
            branch: "main",
            entries: [],
          });
        }
        return HttpResponse.json({
          paneId: "p1",
          branch: "main",
          entries: [{ path: "src/a.ts", xy: " M", rename: null }],
        });
      }),
    );

    render(<PaneDiffsPanel paneId="p1" />);

    await waitFor(() => {
      expect(screen.getByText(/working tree clean/i)).toBeInTheDocument();
    });

    await act(async () => {
      vi.advanceTimersByTime(VISIBLE_POLL_MS);
    });

    await waitFor(() => {
      expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    });
    expect(screen.getByText(/1 changed/i)).toBeInTheDocument();
  });
});
