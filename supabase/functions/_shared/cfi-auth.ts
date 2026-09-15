export type CfiAuthDecision =
  | { ok: true }
  | { ok: false; status: 401 | 500; error: string };

export function requireHeaderSecret(
  supplied: string | null,
  expected: string | undefined | null,
  missingError: string,
  unauthorizedError: string
): CfiAuthDecision {
  if (!expected) {
    return { ok: false, status: 500, error: missingError };
  }
  if (supplied !== expected) {
    return { ok: false, status: 401, error: unauthorizedError };
  }
  return { ok: true };
}

const BRIDGE_ACTIONS = new Set([
  "URGENT_FIXTURE_QUEUE",
  "URGENT_FIXTURE_PEEK",
  "PC_NODE_PRESENCE"
]);

export function authorizeCfiDbRequest(
  suppliedKey: string | null,
  expectedKey: string | undefined | null
): CfiAuthDecision {
  return requireHeaderSecret(
    suppliedKey,
    expectedKey,
    "SERVER_KEY_NOT_CONFIGURED",
    "UNAUTHORIZED"
  );
}

export function authorizePcNodeAction(
  action: string,
  nodeSupplied: string | null,
  nodeExpected: string | undefined | null,
  bridgeSupplied: string | null,
  bridgeExpected: string | undefined | null
): CfiAuthDecision {
  const normalized = String(action || "").toUpperCase();
  if (BRIDGE_ACTIONS.has(normalized)) {
    return requireHeaderSecret(
      bridgeSupplied,
      bridgeExpected,
      "BRIDGE_KEY_NOT_CONFIGURED",
      "UNAUTHORIZED_BRIDGE"
    );
  }
  return requireHeaderSecret(
    nodeSupplied,
    nodeExpected,
    "NODE_KEY_NOT_CONFIGURED",
    "UNAUTHORIZED"
  );
}
