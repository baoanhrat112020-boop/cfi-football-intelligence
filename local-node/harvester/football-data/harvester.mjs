import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const FIXTURE_URL =
  "https://www.football-data.co.uk/fixtures.csv";

const STATE_FILE = resolve(
  "local-node/state/football-data-fixtures.json"
);

const CACHE_FILE = resolve(
  "local-node/cache/football-data-fixtures.csv"
);

async function readState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function saveFile(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function looksLikeHtml(bytes) {
  const head = bytes
    .subarray(0, 512)
    .toString("utf8")
    .trimStart()
    .toLowerCase();

  return (
    head.startsWith("<html") ||
    head.startsWith("<!doctype html") ||
    head.includes("<head>") ||
    head.includes("<title>")
  );
}

function looksLikeCsv(bytes) {
  const head = bytes
    .subarray(0, 2048)
    .toString("utf8")
    .replace(/^\uFEFF/, "");

  return (
    !looksLikeHtml(bytes) &&
    head.includes(",") &&
    /\b(Date|HomeTeam|AwayTeam|Div)\b/i.test(head)
  );
}

export async function checkFootballDataSource(source) {
  const previous = await readState();

  const response = await fetch(FIXTURE_URL, {
    headers: {
      "user-agent": "CFI-Local-Data-Node/1.0",
      "accept": "text/csv,text/plain,*/*"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    return {
      source: source.id,
      status: "SOURCE_ERROR",
      httpStatus: response.status,
      url: FIXTURE_URL,
      cacheUpdated: false,
      ingestionAttempted: false
    };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type");

  if (!looksLikeCsv(bytes)) {
    return {
      source: source.id,
      status: "INVALID_SOURCE_PAYLOAD",
      httpStatus: response.status,
      url: FIXTURE_URL,
      contentType,
      bytes: bytes.length,
      looksLikeHtml: looksLikeHtml(bytes),
      cacheUpdated: false,
      ingestionAttempted: false
    };
  }

  const sha256 = createHash("sha256")
    .update(bytes)
    .digest("hex");

  const changed = previous?.sha256 !== sha256;

  if (changed) {
    await saveFile(CACHE_FILE, bytes);

    await saveFile(
      STATE_FILE,
      JSON.stringify(
        {
          source: source.id,
          url: FIXTURE_URL,
          checkedAt: new Date().toISOString(),
          sha256,
          bytes: bytes.length,
          contentType,
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified")
        },
        null,
        2
      )
    );
  }

  return {
    source: source.id,
    status: changed ? "CHANGED" : "UNCHANGED",
    mode: "SOURCE_CHECK",
    url: FIXTURE_URL,
    httpStatus: response.status,
    contentType,
    bytes: bytes.length,
    sha256,
    previousSha256: previous?.sha256 ?? null,
    cacheUpdated: changed,
    ingestionAttempted: false
  };
}
