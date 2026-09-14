#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const argv = new Set(process.argv.slice(2));
const FULL = argv.has("--full");
const NO_CACHE = argv.has("--no-cache");

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, ".cfi-audit");
const REPORT_DIR = path.join(ROOT, "audit-reports");
fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(REPORT_DIR, { recursive: true });

const report = {
  contract: "CFI_INDEPENDENT_ENGINEERING_AUDITOR_V1",
  mode: FULL ? "FULL" : "INCREMENTAL",
  aiUsage: "ZERO",
  startedAt: new Date().toISOString(),
  changedFiles: [],
  scannedFiles: [],
  risk: "P3",
  findings: [],
  checks: [],
  subsystemScores: {},
  status: "UNKNOWN",
};

const SEVERITY = { P0: 4, P1: 3, P2: 2, P3: 1 };
function normalizedAuditPath(file) {
  return String(file ?? "").replace(/\\/g, "/");
}

function isGeneratedAuditArtifact(file) {
  const f = normalizedAuditPath(file);
  return (
    f.startsWith("audit-reports/") ||
    f.startsWith(".cfi-audit/") ||
    f.startsWith(".cfi-backup/")
  );
}

function isAuditorSelfFile(file) {
  return normalizedAuditPath(file) === "tools/cfi-audit.mjs";
}

function run(command, args = [], options = {}) {
  const started = Date.now();
  const r = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  return {
    exitCode: r.status ?? 1,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    durationMs: Date.now() - started,
  };
}

const git = (args) => run("git", args);

function finding(x) { report.findings.push(x); }
function check(name, r, blocking = true) {
  report.checks.push({
    name,
    status: r.exitCode === 0 ? "PASS" : "FAIL",
    exitCode: r.exitCode,
    durationMs: r.durationMs,
    blocking,
    stdout: r.stdout.slice(-6000),
    stderr: r.stderr.slice(-6000),
  });
}

function changedFiles() {
  const files = new Set();
  for (const args of [
    ["diff", "--name-only", "-z"],
    ["diff", "--cached", "--name-only", "-z"],
    ["ls-files", "--others", "--exclude-standard", "-z"],
  ]) {
    const r = git(args);
    if (r.exitCode === 0) r.stdout.split('\0').filter(Boolean).forEach(f => files.add(f));
  }

  const latest = git(["diff", "--name-only", "-z", "--diff-filter=ACMRTUXB", "HEAD~1", "HEAD"]);
  if (latest.exitCode === 0) latest.stdout.split('\0').filter(Boolean).forEach(f => files.add(f));

  return [...files].filter(f => fs.existsSync(path.join(ROOT, f)));
}

function repositoryFiles() {
  const r=git(['ls-files','--cached','--others','--exclude-standard','-z']);
  check('git inventory',r,true);
  return [...new Set(r.stdout.split('\0').filter(Boolean))]
    .filter(f=>!isGeneratedAuditArtifact(f));
}

function hashFiles(files) {
  const h = crypto.createHash("sha256");
  for (const file of [...files].sort()) {
    h.update(file);
    try { h.update(fs.readFileSync(path.join(ROOT, file))); } catch {}
  }
  h.update(FULL ? "FULL" : "INCREMENTAL");
  h.update(process.version + process.platform + process.arch);
  h.update(fs.readFileSync(new URL(import.meta.url)));
  return h.digest("hex");
}

function classify(files) {
  let risk = "P3";
  const up = c => { if (SEVERITY[c] > SEVERITY[risk]) risk = c; };

  for (const raw of files) {
    const f = raw.toLowerCase();

    if (/(settlement|settle|prediction|predict|strict.prior|canonical|champion)/.test(f) ||
        f.includes("supabase/migrations")) {
      up("P0");
    } else if (/(fixture|provider|ingest|bigdb|discovery|multimarket|multi-market|research|shadow|replay|historical|calibration)/.test(f)) {
      up("P1");
    } else if (/\.(ts|tsx|js|mjs|cjs|sql|json|yaml|yml)$/.test(f)) {
      up("P2");
    }
  }
  return risk;
}

function scan(file) {
  let text = "";
  try { text = fs.readFileSync(path.join(ROOT, file), "utf8"); } catch { return; }
  const lf = file.toLowerCase();

  if (/(^|\/)\.env($|\.)/.test(lf) && !lf.includes(".example")) {
    finding({
      severity: "P0", subsystem: "Security", rule: "SECRET_FILE_CHANGED", file,
      symptom: "Environment/secret file changed.",
      impact: "Credential leakage risk.",
      evidence: file,
      proposedFix: "Remove real secrets from Git and keep sanitized examples only.",
      regressionTest: "Secret-file guard must reject tracked .env files."
    });
  }

  const secrets = [
    ["SUPABASE_SERVICE_ROLE", /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][A-Za-z0-9._\-]{20,}/i],
    ["GENERIC_API_KEY", /(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_\-.]{24,}/i],
    ["PRIVATE_KEY", /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ];
  for (const [name, re] of secrets) {
    if (re.test(text)) finding({
      severity: "P0", subsystem: "Security", rule: name, file,
      symptom: "Potential secret detected in source.",
      impact: "Credential exposure / production compromise.",
      evidence: `Matched ${name}`,
      proposedFix: "Rotate if real, then move to environment bindings.",
      regressionTest: "Secret scan must return PASS."
    });
  }

  if (/(shadow|research|challenger|replay)/i.test(lf) &&
      /decision[_A-Z]?use\s*[:=]\s*true/i.test(text)) {
    finding({
      severity: "P0", subsystem: "Shadow Isolation", rule: "SHADOW_DECISION_USE_TRUE", file,
      symptom: "Shadow/research code enables decision use.",
      impact: "Experimental output could escape into production.",
      evidence: "decisionUse=true in shadow/research path.",
      proposedFix: "Keep decisionUse=false until explicit promotion gate.",
      regressionTest: "Shadow isolation test must fail on decisionUse=true."
    });
  }

  if (/(predict|prediction|model|forecast)/i.test(lf) &&
      /\b(?:reconstruct\w*prediction\w*|prediction\w*reconstruct\w*)\s*\(/i.test(text)) {
    finding({
      severity: "P0", subsystem: "Prediction Integrity", rule: "POSTMATCH_RECONSTRUCTION_RISK", file,
      symptom: "Reconstruction-named prediction callable requires review.",
      impact: "Post-match knowledge may contaminate historical predictions.",
      evidence: "Prediction reconstruction callable detected; rejection flags alone are not evidence of reconstruction.",
      proposedFix: "Use immutable pre-kickoff snapshots only.",
      regressionTest: "Settlement without a pre-match snapshot must fail closed."
    });
  }

  if (/(predict|prediction|forecast|model)/i.test(lf) &&
      /\b(actual_(ht|ft|score|result)|settled_(score|result)|post_match_result)\b/i.test(text)) {
    finding({
      severity: "P0", subsystem: "Strict Prior", rule: "ACTUAL_RESULT_REFERENCE_IN_PREDICTION", file,
      symptom: "Prediction path references post-match result fields.",
      impact: "Potential strict-prior leakage.",
      evidence: "actual/settled/post-match field detected.",
      proposedFix: "Separate pre-match feature and settlement schemas.",
      regressionTest: "Result fields must be unreachable by prediction runtime."
    });
  }

  if (/(settlement|canonical|prediction|snapshot)/i.test(lf) &&
      /\.(sql|ts|js|mjs)$/i.test(lf) &&
      /\b(TRUNCATE|DROP\s+TABLE)\b/i.test(text)) {
    finding({
      severity: "P0", subsystem: "Data Integrity", rule: "DESTRUCTIVE_CANONICAL_SQL", file,
      symptom: "Destructive SQL near canonical/settlement code.",
      impact: "Canonical fixtures or append-only evidence could be lost.",
      evidence: "TRUNCATE or DROP TABLE detected.",
      proposedFix: "Use non-destructive migrations preserving canonical evidence.",
      regressionTest: "Migration audit must block destructive canonical operations."
    });
  }

  if (/\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/i.test(lf) &&
      /\b(describe|test|it)\.(skip|only)\s*\(/.test(text)) {
    finding({
      severity: "P1", subsystem: "Testing", rule: "TEST_BYPASS", file,
      symptom: ".skip() or .only() detected.",
      impact: "Regression gates may silently lose coverage.",
      evidence: "Focused/skipped test marker detected.",
      proposedFix: "Remove skip/only or explicitly quarantine.",
      regressionTest: "No accidental skip/only markers."
    });
  }

  if (/(shadow|research|challenger|replay)/i.test(lf) &&
      /\.(ts|js|mjs)$/i.test(lf) &&
      /\.(insert|upsert|update|delete)\s*\(/i.test(
        // Hash.update is a local digest operation, not a database mutation.
        text.replace(/\bcreateHash\(\s*(['"])[^'"]+\1\s*\)\s*\.update\s*\(/g, 'hashInput(')
      )) {
    finding({
      severity: "P1", subsystem: "Shadow Isolation", rule: "SHADOW_DB_WRITE_REVIEW_REQUIRED", file,
      symptom: "Database mutation found in shadow/research code.",
      impact: "Research may mutate production/canonical storage.",
      evidence: "insert/upsert/update/delete invocation detected.",
      proposedFix: "Verify isolated shadow destination and block production bindings.",
      regressionTest: "Shadow write contract must validate destination tables/bindings."
    });
  }

  const debt = isAuditorSelfFile(file) ? [] : (text.match(/\b(TODO|FIXME|HACK|TEMPORARY)\b/gi) || []);
  if (debt.length >= 5) {
    finding({
      severity: "P2", subsystem: "Maintainability", rule: "TECH_DEBT_CLUSTER", file,
      symptom: `${debt.length} technical-debt markers found.`,
      impact: "Temporary logic increases regression risk.",
      evidence: `${debt.length} TODO/FIXME/HACK/TEMPORARY markers.`,
      proposedFix: "Convert meaningful markers to backlog and remove stale ones.",
      regressionTest: "Debt count should not grow silently."
    });
  }
}

function packageJson() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")); }
  catch { return null; }
}

function runChecks(risk) {
  check("git diff --check", git(["diff", "--check"]), true);

  const pkg = packageJson();
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    check('package.json', {exitCode:1,stdout:'',stderr:'Missing or invalid package manifest',durationMs:0});
    return;
  }
  const s = pkg.scripts || {};

  if (FULL && (typeof s.test !== 'string' || !s.test.trim())) {
    check('npm test required', {exitCode:1,stdout:'',stderr:'Full audit requires a test command',durationMs:0});
  }

  if (FULL && fs.existsSync(path.join(ROOT, 'package-lock.json'))) {
    check('npm audit', run('npm', ['audit', '--package-lock-only', '--audit-level=moderate', '--fetch-timeout=20000', '--fetch-retries=0']), true);
  }

  if (s.lint) check("npm run lint", run("npm", ["run", "lint"]), true);
  if (s.typecheck) check("npm run typecheck", run("npm", ["run", "typecheck"]), true);
  if (s.test && (FULL || risk === "P0" || risk === "P1")) {
    check("npm test", run("npm", ["test"]), true);
  }
  if (FULL && s.build) check("npm run build", run("npm", ["run", "build"]), true);

  const hasWranglerConfig =
    fs.existsSync(path.join(ROOT, "wrangler.toml")) ||
    fs.existsSync(path.join(ROOT, "wrangler.json")) ||
    fs.existsSync(path.join(ROOT, "wrangler.jsonc"));

  const localWrangler = fs.existsSync(path.join(
    ROOT, "node_modules", ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler"
  ));

  if (FULL && hasWranglerConfig && !localWrangler) {
    check('wrangler deploy --dry-run', {exitCode:1,stdout:'',stderr:'Local Wrangler is missing; install locked dependencies before auditing',durationMs:0});
  }

  if (hasWranglerConfig && localWrangler &&
      (FULL || report.changedFiles.some(f => /(worker|wrangler|supabase\/functions)/i.test(f)))) {
    check("wrangler deploy --dry-run",
      run("npx", ["--no-install", "wrangler", "deploy", "--dry-run"]), true);
  }
}

function scores() {
  const systems = [
    "Security", "Strict Prior", "Prediction Integrity",
    "Data Integrity", "Shadow Isolation", "Testing", "Maintainability"
  ];
  for (const subsystem of systems) {
    let score = 100;
    for (const f of report.findings.filter(x => x.subsystem === subsystem)) {
      score -= f.severity === "P0" ? 35 : f.severity === "P1" ? 20 : f.severity === "P2" ? 8 : 3;
    }
    report.subsystemScores[subsystem] = Math.max(0, score);
  }
}

function writeReports() {
  const j = path.join(REPORT_DIR, "cfi-audit-latest.json");
  const m = path.join(REPORT_DIR, "cfi-audit-latest.md");
  fs.writeFileSync(j, JSON.stringify(report, null, 2));

  const c = {P0:0,P1:0,P2:0,P3:0};
  for (const f of report.findings) c[f.severity]++;

  let md = `# CFI Engineering Audit

**Contract:** ${report.contract}
**Mode:** ${report.mode}
**AI usage:** ${report.aiUsage}
**Risk:** ${report.risk}
**Status:** ${report.status}
**Started:** ${report.startedAt}
**Finished:** ${report.finishedAt}

## Severity

| Severity | Count |
|---|---:|
| P0 | ${c.P0} |
| P1 | ${c.P1} |
| P2 | ${c.P2} |
| P3 | ${c.P3} |

## Subsystem scores

| Subsystem | Score |
|---|---:|
`;

  for (const [name, score] of Object.entries(report.subsystemScores)) {
    md += `| ${name} | ${score}/100 |\n`;
  }

  md += "\n## Automated checks\n\n";
  for (const x of report.checks) md += `- **${x.status}** â€” ${x.name} (${x.durationMs} ms)\n`;

  md += "\n## Findings\n\n";
  if (!report.findings.length) md += "No findings.\n";

  for (const [i, f] of report.findings
    .sort((a,b) => SEVERITY[b.severity] - SEVERITY[a.severity])
    .entries()) {
    md += `### ${i+1}. ${f.severity} â€” ${f.rule}

**Subsystem:** ${f.subsystem}

**File:** ${f.file || "-"}

**Symptom:** ${f.symptom}

**Impact:** ${f.impact}

**Evidence:** ${f.evidence}

**Proposed fix:** ${f.proposedFix}

**Regression test:** ${f.regressionTest}

`;
  }

  fs.writeFileSync(m, md);

  console.log("========================================");
  console.log("CFI INDEPENDENT ENGINEERING AUDITOR V1");
  console.log("========================================");
  console.log(`MODE       : ${report.mode}`);
  console.log("AI USAGE   : ZERO");
  console.log(`RISK       : ${report.risk}`);
  console.log(`STATUS     : ${report.status}`);
  console.log(`FINDINGS   : ${report.findings.length}`);
  console.log(`REPORT     : audit-reports/cfi-audit-latest.md`);
  console.log("========================================");
}

function main() {
  report.changedFiles = changedFiles();
  const files=repositoryFiles();
  report.scannedFiles = (FULL ? files : report.changedFiles).filter(f=>!isGeneratedAuditArtifact(f));
  report.risk = classify(report.scannedFiles);

  const key = hashFiles(files);
  const cacheFile = path.join(CACHE_DIR, "cache.json");

  if (!FULL && !NO_CACHE && report.checks.every(c=>c.status==='PASS') && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      if (cached.key === key && cached.status === "PASS") {
        console.log("CFI AUDIT: PASS (cached, zero tests rerun, zero AI usage)");
        process.exit(0);
      }
    } catch {}
  }

  for (const f of report.scannedFiles) {
    if (isGeneratedAuditArtifact(f)) continue;
    if (/\.(ts|tsx|js|mjs|cjs|sql|json|yaml|yml|md|env)$/i.test(f) ||
        path.basename(f).startsWith(".env")) scan(f);
  }

  runChecks(report.risk);
  scores();

  const blockingFinding = report.findings.some(f => f.severity === "P0" || f.severity === "P1");
  const failedCheck = report.checks.some(c => c.blocking && c.status === "FAIL");
  report.status = blockingFinding || failedCheck ? "FAIL" : "PASS";
  report.finishedAt = new Date().toISOString();

  writeReports();
  fs.writeFileSync(cacheFile, JSON.stringify({key, status: report.status, timestamp: report.finishedAt}, null, 2));
  process.exit(report.status === "PASS" ? 0 : 1);
}

main();
