export function normalizeRefreshRequest(body = {}) {
  if (body === null || Array.isArray(body) || typeof body !== "object") {
    throw new Error("INVALID_REFRESH_PAYLOAD");
  }

  const concurrency = body.concurrency === undefined ? 3 : Number(body.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) {
    throw new Error("INVALID_CONCURRENCY");
  }

  const filters = { currentOnly: true };
  if (body.sourceIds !== undefined) {
    if (!Array.isArray(body.sourceIds) || body.sourceIds.some((id) => typeof id !== "string" || !id.trim())) {
      throw new Error("INVALID_SOURCE_IDS");
    }
    filters.sourceIds = [...new Set(body.sourceIds.map((id) => id.trim()))];
  }

  return { concurrency, filters };
}
