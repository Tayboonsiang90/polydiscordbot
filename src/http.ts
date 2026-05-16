const defaultTimeoutMs = 20_000;

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = defaultTimeoutMs): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;

  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    throw new Error(`Request failed for ${url}: ${formatNetworkError(error)}`);
  }
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
