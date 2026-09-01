const DEFAULT_PAGE_SIZE = 1000;

function decodeBase64UrlJson(segment) {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function classifyResearchKey(key) {
  if (!key || typeof key !== 'string') {
    throw new Error('CFI_RESEARCH_PRIVILEGED_KEY_REQUIRED');
  }

  if (key.startsWith('sb_publishable_')) {
    throw new Error('CFI_RESEARCH_PRIVILEGED_KEY_REQUIRED:PUBLISHABLE_KEY_REJECTED');
  }

  if (key.startsWith('sb_secret_')) {
    return { kind: 'secret', role: 'service_role' };
  }

  const parts = key.split('.');
  if (parts.length === 3) {
    const payload = decodeBase64UrlJson(parts[1]);
    if (payload?.role !== 'service_role') {
      throw new Error('CFI_RESEARCH_PRIVILEGED_KEY_REQUIRED:NON_SERVICE_ROLE_JWT_REJECTED');
    }
    return { kind: 'legacy_service_role_jwt', role: 'service_role' };
  }

  throw new Error('CFI_RESEARCH_PRIVILEGED_KEY_REQUIRED:UNRECOGNIZED_KEY_TYPE');
}

export function resolveResearchCredentials(env = process.env) {
  const baseUrl = env.CFI_SUPABASE_URL ?? env.SUPABASE_URL;
  if (!baseUrl) throw new Error('CFI_SUPABASE_URL_REQUIRED');

  const key = env.CFI_SUPABASE_SERVICE_ROLE_KEY
    ?? env.SUPABASE_SERVICE_ROLE_KEY
    ?? env.CFI_SUPABASE_KEY;
  classifyResearchKey(key);
  return { baseUrl, key };
}

function safeLabel(label) {
  return String(label ?? 'DATASET').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'DATASET';
}

export function createResearchSupabaseReader({
  baseUrl,
  serviceRoleKey,
  key,
  fetchImpl = fetch,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  if (!baseUrl) throw new Error('CFI_SUPABASE_URL_REQUIRED');
  const privilegedKey = serviceRoleKey ?? key;
  const keyInfo = classifyResearchKey(privilegedKey);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10000) {
    throw new Error('CFI_RESEARCH_INVALID_PAGE_SIZE');
  }

  async function fetchPage(path, offset) {
    const url = new URL(`/rest/v1/${path}`, baseUrl);
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));

    const headers = {
      apikey: privilegedKey,
      Accept: 'application/json',
    };
    if (keyInfo.kind === 'legacy_service_role_jwt') {
      headers.Authorization = `Bearer ${privilegedKey}`;
    }

    let response;
    try {
      response = await fetchImpl(url, { headers });
    } catch {
      throw new Error(`CFI_RESEARCH_SUPABASE_READ_FAILED:NETWORK:${url.pathname}`);
    }

    if (!response?.ok) {
      const status = Number(response?.status ?? 0);
      throw new Error(`CFI_RESEARCH_SUPABASE_READ_FAILED:${status}:${url.pathname}`);
    }

    const page = await response.json();
    if (!Array.isArray(page)) {
      throw new Error(`CFI_RESEARCH_SUPABASE_RESPONSE_NOT_ARRAY:${url.pathname}`);
    }
    return page;
  }

  async function readAll(path, { critical = false, label = 'dataset' } = {}) {
    const rows = [];
    for (let offset = 0;; offset += pageSize) {
      const page = await fetchPage(path, offset);
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    if (critical && rows.length === 0) {
      throw new Error(`CFI_RESEARCH_EMPTY_${safeLabel(label)}`);
    }
    return rows;
  }

  return Object.freeze({
    readAll,
    keyKind: keyInfo.kind,
    privileged: true,
  });
}
