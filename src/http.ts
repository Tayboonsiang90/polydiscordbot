const defaultTimeoutMs = 20_000;
const defaultRetryDelaysMs = [1_000, 3_000];

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = defaultTimeoutMs): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= defaultRetryDelaysMs.length; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;

    try {
      return await fetch(url, { ...init, signal });
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt === defaultRetryDelaysMs.length) {
        break;
      }

      await delay(defaultRetryDelaysMs[attempt]);
    }
  }

  throw new Error(`Request failed for ${url}: ${formatNetworkError(lastError)}`);
}

function isTransientNetworkError(error: unknown): boolean {
  const message = formatNetworkError(error).toLowerCase();
  const codes = collectErrorCodes(error);
  return (
    codes.some((code) =>
      ["ECONNRESET", "ECONNABORTED", "EHOSTUNREACH", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)
    ) ||
    message.includes("timeout") ||
    message.includes("etimedout") ||
    message.includes("timed out") ||
    message.includes("connection reset")
  );
}

function formatNetworkError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause;
    if (cause instanceof Error) {
      const code = "code" in cause && typeof cause.code === "string" ? ` ${cause.code}` : "";
      return `${error.message}: ${cause.message}${code}`;
    }

    return error.message;
  }

  return String(error);
}

function collectErrorCodes(error: unknown): string[] {
  if (!error || typeof error !== "object") {
    return [];
  }

  const codes: string[] = [];
  const maybeCode = "code" in error ? error.code : undefined;
  if (typeof maybeCode === "string") {
    codes.push(maybeCode);
  }

  const maybeCause = "cause" in error ? error.cause : undefined;
  codes.push(...collectErrorCodes(maybeCause));
  return codes;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
