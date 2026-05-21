import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "../src/http.js";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("wraps network errors with request context", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ETIMEDOUT");
      })
    );

    const assertion = expect(fetchWithTimeout("https://example.com")).rejects.toThrow(
      "Request failed for https://example.com: connect ETIMEDOUT"
    );
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("includes fetch error causes when available", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed", { cause: new Error("Connect Timeout Error") });
      })
    );

    const assertion = expect(fetchWithTimeout("https://example.com")).rejects.toThrow(
      "Request failed for https://example.com: fetch failed: Connect Timeout Error"
    );
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("retries transient network errors before failing", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed", { cause: new Error("Connect Timeout Error") }))
      .mockRejectedValueOnce(new Error("connect ETIMEDOUT"))
      .mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const assertion = expect(fetchWithTimeout("https://example.com")).resolves.toMatchObject({ ok: true });
    await vi.runAllTimersAsync();

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-transient fetch errors", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("bad request body");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithTimeout("https://example.com")).rejects.toThrow(
      "Request failed for https://example.com: bad request body"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
