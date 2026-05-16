import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "../src/http.js";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wraps network errors with request context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ETIMEDOUT");
      })
    );

    await expect(fetchWithTimeout("https://example.com")).rejects.toThrow(
      "Request failed for https://example.com: connect ETIMEDOUT"
    );
  });

  it("includes fetch error causes when available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed", { cause: new Error("Connect Timeout Error") });
      })
    );

    await expect(fetchWithTimeout("https://example.com")).rejects.toThrow(
      "Request failed for https://example.com: fetch failed: Connect Timeout Error"
    );
  });
});
