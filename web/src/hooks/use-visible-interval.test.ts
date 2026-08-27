import { act, renderHook } from "@testing-library/react";

import { VISIBLE_POLL_MS, useVisibleInterval } from "./use-visible-interval";
import { resetIdleLock, setLocked } from "@/lib/idle";

describe("useVisibleInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetIdleLock();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetIdleLock();
  });

  test("ticks on the interval while visible", () => {
    const tick = vi.fn();
    renderHook(() => useVisibleInterval(tick, VISIBLE_POLL_MS));

    expect(tick).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(VISIBLE_POLL_MS);
    });
    expect(tick).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(VISIBLE_POLL_MS);
    });
    expect(tick).toHaveBeenCalledTimes(2);
  });

  test("skips ticks while the document is hidden", () => {
    const tick = vi.fn();
    renderHook(() => useVisibleInterval(tick, VISIBLE_POLL_MS));

    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    act(() => {
      vi.advanceTimersByTime(VISIBLE_POLL_MS);
    });
    expect(tick).not.toHaveBeenCalled();
  });

  test("skips ticks while idle-locked", () => {
    const tick = vi.fn();
    renderHook(() => useVisibleInterval(tick, VISIBLE_POLL_MS));

    setLocked(true);
    act(() => {
      vi.advanceTimersByTime(VISIBLE_POLL_MS);
    });
    expect(tick).not.toHaveBeenCalled();
  });

  test("kicks immediately on focus / visibility", () => {
    const tick = vi.fn();
    renderHook(() => useVisibleInterval(tick, VISIBLE_POLL_MS));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(tick).toHaveBeenCalledTimes(1);

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(tick).toHaveBeenCalledTimes(2);
  });
});
