#!/usr/bin/env node
/**
 * scripts/verify-api.mjs — REST contract characterization suite.
 *
 * Purpose: pin the external behavior of /api/projects and /api/presets —
 * status codes, response bodies, error envelopes and ordering rules — so a
 * refactor can move the implementation around while the contract stays
 * byte-identical (timestamps and server-generated ids normalized).
 *
 * Usage:
 *   node scripts/verify-api.mjs --record   # (re)record the contract file
 *   node scripts/verify-api.mjs            # compare against the recorded file
 *   node scripts/verify-api.mjs <file>     # use a non-default contract file
 *
 * Environment:
 *   API_BASE  base URL of a running dev server (default http://localhost:3100)
 *
 * Determinism requirements (the harness assumes them):
 *   1. A FRESH database — every row is created by this run (reset with:
 *      stop server, `rm -f db/custom.db`, `npx prisma db push`, start server).
 *   2. Requests run strictly sequentially, so list order (updatedAt desc)
 *      is reproducible.
 *   3. All row ids are client-supplied (fixed strings); server timestamps
 *      are normalized to <TS> in the recorded output.
 *
 * The recorded contract file is committed at
 * docs/verification/api-contract.json so `npm run verify:api` doubles as a
 * permanent regression test against drift.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API_BASE = process.env.API_BASE ?? "http://localhost:3100";
const DEFAULT_CONTRACT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "verification",
  "api-contract.json"
);
const userArgs = process.argv.slice(2);
const RECORD = userArgs.includes("--record");
const CONTRACT_FILE = userArgs.find((a) => !a.startsWith("--")) ?? DEFAULT_CONTRACT;

// Owner tokens: valid lowercase-hex+dashes shapes only.
const OWNER_A = "11111111-2222-3333-4444-555555555555";
const OWNER_B = "abcdefab-cdef-abcd-efab-cdefabcdefab";
const OWNER_BAD = "!!invalid!!";

/** ISO-timestamp shape produced by Date#toISOString / Prisma serialization. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** Deep-normalize a parsed JSON body: ISO timestamps → "<TS>". */
function normalize(value) {
  if (typeof value === "string") return ISO_RE.test(value) ? "<TS>" : value;
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = normalize(value[key]);
    return out;
  }
  return value;
}

/** Collected checks: [{ name, status, body }] with normalized bodies. */
const results = [];

/**
 * Perform one request and record the normalized status + body.
 * `body` (object) is JSON-encoded with the application/json content type;
 * `rawBody`/`noContentType` exercise the body guard.
 */
async function check(name, method, path_, { body, rawBody, owner, noContentType } = {}) {
  const headers = {};
  if (owner !== undefined) headers["x-sevenseg-owner"] = owner;
  const hasJson = body !== undefined;
  if (hasJson) headers["content-type"] = "application/json";
  if (rawBody !== undefined && !noContentType) headers["content-type"] = "application/json";

  const res = await fetch(`${API_BASE}${path_}`, {
    method,
    headers,
    body: hasJson ? JSON.stringify(body) : rawBody,
  });
  let parsed = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      parsed = normalize(JSON.parse(text));
    } catch {
      parsed = `<unparsable: ${text.slice(0, 80)}>`;
    }
  }
  results.push({ name, status: res.status, body: parsed });
  return parsed;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** All-zero output pattern for one truth-table row (segment → 0/1/"X"). */
const zeroOutputs = {
  A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, DP: 0,
};

/** n-row truth table with all-zero outputs — the app's own wire format. */
function zeroRows(n) {
  return Array.from({ length: n }, (_, i) => ({ input: i, outputs: { ...zeroOutputs } }));
}

const validTablePreset = {
  id: "user:baseline-01",
  name: "Baseline Table",
  category: "User",
  inputBits: 4,
  generator: "literal",
  options: { tableStartCode: 0, invalidBehavior: "blank" },
  table: { inputBits: 4, rows: zeroRows(16) },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const validFontPreset = {
  id: "user:baseline-font-01",
  name: "Baseline Font",
  builtin: false,
  glyphs: [
    { char: "0", segments: "ABCDEF" },
    { char: "1", segments: "BC" },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const validProjectData = {
  version: 1,
  name: "Baseline Project",
  inputBits: 4,
  displayMode: "custom",
  invalidBehavior: "blank",
  currentInput: 0,
  truthTable: { inputBits: 4, rows: zeroRows(16) },
  displaySettings: {
    activeColor: "#ff2d2d",
    inactiveColor: "#3a1214",
    brightness: 0.95,
    commonAnode: false,
    reverseLogic: false,
    showDP: true,
    skew: true,
  },
  coverExcluded: {},
  coverAdded: {},
};

// ---------------------------------------------------------------------------
// Sequence (order matters: rows are created and mutated in a fixed timeline)
// ---------------------------------------------------------------------------

async function runSequence() {
  // --- /api/projects: body guard ------------------------------------------
  await check("projects: GET empty list (no owner)", "GET", "/api/projects");
  await check("projects: GET empty full list", "GET", "/api/projects?full=1&limit=5&offset=0");
  await check("projects: POST without content-type → 415", "POST", "/api/projects", {
    rawBody: "{}",
    noContentType: true,
    owner: OWNER_A,
  });
  await check("projects: POST oversized body → 413", "POST", "/api/projects", {
    rawBody: '{"a":"' + "a".repeat(1_000_100) + '"}',
    owner: OWNER_A,
  });
  await check("projects: POST malformed JSON → 400", "POST", "/api/projects", {
    rawBody: "{nope",
    owner: OWNER_A,
  });
  await check("projects: POST array body → 400", "POST", "/api/projects", {
    rawBody: "[]",
    owner: OWNER_A,
  });
  await check("projects: POST string body → 400", "POST", "/api/projects", {
    rawBody: '"str"',
    owner: OWNER_A,
  });

  // --- /api/projects: field validation -------------------------------------
  await check("projects: POST missing name → 400", "POST", "/api/projects", {
    body: { inputBits: 4, data: validProjectData },
    owner: OWNER_A,
  });
  await check("projects: POST empty name → 400", "POST", "/api/projects", {
    body: { name: "   ", inputBits: 4, data: validProjectData },
    owner: OWNER_A,
  });
  await check("projects: POST long name → 400", "POST", "/api/projects", {
    body: { name: "x".repeat(101), inputBits: 4, data: validProjectData },
    owner: OWNER_A,
  });
  await check("projects: POST bad inputBits → 400", "POST", "/api/projects", {
    body: { name: "n", inputBits: 3, data: validProjectData },
    owner: OWNER_A,
  });
  await check("projects: POST bad id charset → 400", "POST", "/api/projects", {
    body: { name: "n", inputBits: 4, data: validProjectData, id: "bad id!" },
    owner: OWNER_A,
  });
  await check("projects: POST data non-object → 400", "POST", "/api/projects", {
    body: { name: "n", inputBits: 4, data: "str" },
    owner: OWNER_A,
  });
  await check("projects: POST data version 99 → 400 with E-201", "POST", "/api/projects", {
    body: { name: "n", inputBits: 4, data: { version: 99 } },
    owner: OWNER_A,
  });

  // --- /api/projects: create + ownership -----------------------------------
  const created = await check("projects: POST valid (owner A) → 201", "POST", "/api/projects", {
    body: { name: "Baseline Project", inputBits: 4, data: validProjectData, id: "baseline-project-01" },
    owner: OWNER_A,
  });
  if (created === null || created.id !== "baseline-project-01") {
    throw new Error("baseline-project-01 was not created — aborting (fresh DB required?)");
  }
  await check("projects: POST duplicate id → 409", "POST", "/api/projects", {
    body: { name: "Other", inputBits: 4, data: validProjectData, id: "baseline-project-01" },
    owner: OWNER_A,
  });
  await check("projects: POST valid shared (no owner) → 201", "POST", "/api/projects", {
    body: { name: "Shared Project", inputBits: 5, data: { ...validProjectData, inputBits: 5, truthTable: { inputBits: 5, rows: zeroRows(32) } }, id: "baseline-shared-01" },
  });

  // --- /api/projects: list filtering + pagination ---------------------------
  await check("projects: GET full list (owner A) → shared+mine, newest first", "GET", "/api/projects?full=1", { owner: OWNER_A });
  await check("projects: GET list (owner B) → shared only", "GET", "/api/projects", { owner: OWNER_B });
  await check("projects: GET list (malformed owner header) → shared only", "GET", "/api/projects", { owner: OWNER_BAD });
  await check("projects: GET list (no owner) → shared only", "GET", "/api/projects");

  // --- /api/projects/[id]: read rules ---------------------------------------
  await check("projects: GET own row → 200", "GET", "/api/projects/baseline-project-01", { owner: OWNER_A });
  await check("projects: GET foreign row (owner B) → 404 hides existence", "GET", "/api/projects/baseline-project-01", { owner: OWNER_B });
  await check("projects: GET foreign row (no owner) → 404", "GET", "/api/projects/baseline-project-01");
  await check("projects: GET shared row (owner B) → 200", "GET", "/api/projects/baseline-shared-01", { owner: OWNER_B });
  await check("projects: GET unknown id → 404", "GET", "/api/projects/unknown-xx-01", { owner: OWNER_A });

  // --- /api/projects/[id]: PUT rules ----------------------------------------
  await check("projects: PUT without content-type → 415 (guard before 404)", "PUT", "/api/projects/unknown-xx-01", {
    rawBody: "{}",
    noContentType: true,
    owner: OWNER_A,
  });
  await check("projects: PUT unknown id → 404", "PUT", "/api/projects/unknown-xx-01", {
    body: { name: "x" },
    owner: OWNER_A,
  });
  await check("projects: PUT stale expectedUpdatedAt → 409 conflict", "PUT", "/api/projects/baseline-project-01", {
    body: { name: "Renamed", expectedUpdatedAt: "2000-01-01T00:00:00.000Z" },
    owner: OWNER_A,
  });
  await check("projects: PUT foreign row → 403", "PUT", "/api/projects/baseline-project-01", {
    body: { name: "Nope" },
    owner: OWNER_B,
  });
  await check("projects: PUT rename → 200", "PUT", "/api/projects/baseline-project-01", {
    body: { name: "Renamed Project" },
    owner: OWNER_A,
  });
  await check("projects: PUT empty body → 200 no-op", "PUT", "/api/projects/baseline-project-01", {
    body: { id: "ignored-unknown-field", extra: true },
    owner: OWNER_A,
  });
  await check("projects: PUT invalid name → 400", "PUT", "/api/projects/baseline-project-01", {
    body: { name: "  " },
    owner: OWNER_A,
  });
  await check("projects: PUT invalid data → 400 with E-201", "PUT", "/api/projects/baseline-project-01", {
    body: { data: { version: 99 } },
    owner: OWNER_A,
  });
  await check("projects: PUT shared row (owner B) → 200 (shared writable)", "PUT", "/api/projects/baseline-shared-01", {
    body: { name: "Shared Renamed" },
    owner: OWNER_B,
  });

  // --- /api/projects: pagination after mutations -----------------------------
  await check("projects: GET limit=1 → newest only", "GET", "/api/projects?limit=1", { owner: OWNER_A });
  await check("projects: GET limit=0 → clamped to 1", "GET", "/api/projects?limit=0", { owner: OWNER_A });
  await check("projects: GET offset=1 → skips newest", "GET", "/api/projects?offset=1", { owner: OWNER_A });
  await check("projects: GET limit=abc → default 100", "GET", "/api/projects?limit=abc", { owner: OWNER_A });

  // --- /api/projects/[id]: DELETE rules --------------------------------------
  await check("projects: DELETE foreign row → 403", "DELETE", "/api/projects/baseline-project-01", { owner: OWNER_B });
  await check("projects: DELETE own row → 204", "DELETE", "/api/projects/baseline-project-01", { owner: OWNER_A });
  await check("projects: DELETE again → 404", "DELETE", "/api/projects/baseline-project-01", { owner: OWNER_A });
  await check("projects: GET list after delete (owner A) → shared only", "GET", "/api/projects", { owner: OWNER_A });

  // --- /api/presets: body guard + validation --------------------------------
  await check("presets: GET empty list (no owner)", "GET", "/api/presets");
  await check("presets: POST without content-type → 415", "POST", "/api/presets", {
    rawBody: "{}",
    noContentType: true,
    owner: OWNER_A,
  });
  await check("presets: POST missing id → 400", "POST", "/api/presets", {
    body: { kind: "table", name: "n", data: validTablePreset },
    owner: OWNER_A,
  });
  await check("presets: POST bad id prefix → 400", "POST", "/api/presets", {
    body: { id: "notuser:01", kind: "table", name: "n", data: validTablePreset },
    owner: OWNER_A,
  });
  await check("presets: POST bad kind → 400", "POST", "/api/presets", {
    body: { id: "user:x1", kind: "other", name: "n", data: validTablePreset },
    owner: OWNER_A,
  });
  await check("presets: POST missing name → 400", "POST", "/api/presets", {
    body: { id: "user:x1", kind: "table", data: validTablePreset },
    owner: OWNER_A,
  });
  await check("presets: POST data.id mismatch → 400", "POST", "/api/presets", {
    body: { id: "user:mismatch-01", kind: "table", name: "n", data: validTablePreset },
    owner: OWNER_A,
  });
  await check("presets: POST invalid data → 400 with E-280", "POST", "/api/presets", {
    body: { id: "user:baddata-01", kind: "table", name: "n", data: { wrong: true } },
    owner: OWNER_A,
  });

  // --- /api/presets: create + list -------------------------------------------
  await check("presets: POST valid table preset (owner A) → 201", "POST", "/api/presets", {
    body: { id: "user:baseline-01", kind: "table", name: "Baseline Table", data: validTablePreset },
    owner: OWNER_A,
  });
  await check("presets: POST duplicate → 409", "POST", "/api/presets", {
    body: { id: "user:baseline-01", kind: "table", name: "Again", data: validTablePreset },
    owner: OWNER_A,
  });
  await check("presets: POST valid font preset (shared) → 201", "POST", "/api/presets", {
    body: { id: "user:baseline-font-01", kind: "font", name: "Baseline Font", data: validFontPreset },
  });
  await check("presets: GET list (owner A) → both, newest first", "GET", "/api/presets?full=1", { owner: OWNER_A });
  await check("presets: GET slim list (owner B) → shared only, slim shape", "GET", "/api/presets", { owner: OWNER_B });

  // --- /api/presets/[id]: read + update rules ---------------------------------
  await check("presets: GET own row → 200", "GET", "/api/presets/user:baseline-01", { owner: OWNER_A });
  await check("presets: GET foreign row → 404", "GET", "/api/presets/user:baseline-01", { owner: OWNER_B });
  await check("presets: GET unknown → 404", "GET", "/api/presets/user:unknown-01", { owner: OWNER_A });
  await check("presets: PUT stale expectedUpdatedAt → 409", "PUT", "/api/presets/user:baseline-01", {
    body: { name: "x", expectedUpdatedAt: "2000-01-01T00:00:00.000Z" },
    owner: OWNER_A,
  });
  await check("presets: PUT foreign row → 403", "PUT", "/api/presets/user:baseline-01", {
    body: { name: "x" },
    owner: OWNER_B,
  });
  await check("presets: PUT rename → 200", "PUT", "/api/presets/user:baseline-01", {
    body: { name: "Renamed Table" },
    owner: OWNER_A,
  });
  await check("presets: PUT empty body → 200 no-op (id/kind immutable, ignored)", "PUT", "/api/presets/user:baseline-01", {
    body: { id: "user:something-else", kind: "font" },
    owner: OWNER_A,
  });
  await check("presets: PUT font data against table row → 400 E-280 (kind-validated)", "PUT", "/api/presets/user:baseline-01", {
    body: { data: { ...validFontPreset, id: "user:baseline-01" } },
    owner: OWNER_A,
  });
  await check("presets: PUT data with mismatched embedded id → 400", "PUT", "/api/presets/user:baseline-01", {
    body: { data: { ...validTablePreset, id: "user:other-01" } },
    owner: OWNER_A,
  });
  await check("presets: PUT shared row (owner B) → 200 (shared writable)", "PUT", "/api/presets/user:baseline-font-01", {
    body: { name: "Shared Font Renamed" },
    owner: OWNER_B,
  });

  // --- /api/presets/[id]: delete rules -----------------------------------------
  await check("presets: DELETE foreign row → 403", "DELETE", "/api/presets/user:baseline-01", { owner: OWNER_B });
  await check("presets: DELETE shared row (owner B) → 204 (shared deletable)", "DELETE", "/api/presets/user:baseline-font-01", { owner: OWNER_B });
  await check("presets: DELETE own row → 204", "DELETE", "/api/presets/user:baseline-01", { owner: OWNER_A });
  await check("presets: GET list after deletes → empty", "GET", "/api/presets", { owner: OWNER_A });
}

// ---------------------------------------------------------------------------
// Record / compare driver
// ---------------------------------------------------------------------------

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  process.stdout.write(`verify-api: hitting ${API_BASE} ...\n`);
  await runSequence();

  const current = {
    base: API_BASE,
    checkCount: results.length,
    checks: results,
  };

  if (RECORD) {
    writeFileSync(CONTRACT_FILE, JSON.stringify(current, null, 2) + "\n");
    process.stdout.write(`verify-api: recorded ${results.length} checks to ${CONTRACT_FILE}\n`);
    return;
  }

  let recorded;
  try {
    recorded = JSON.parse(readFileSync(CONTRACT_FILE, "utf8"));
  } catch {
    process.stderr.write(`verify-api: cannot read contract file ${CONTRACT_FILE} (run with --record first)\n`);
    process.exit(2);
  }

  let failed = 0;
  const max = Math.max(recorded.checks.length, current.checks.length);
  for (let i = 0; i < max; i++) {
    const want = recorded.checks[i];
    const got = current.checks[i];
    if (!want || !got || !deepEqual(want, got)) {
      failed++;
      const name = got?.name ?? want?.name ?? `<check ${i}>`;
      process.stdout.write(`\nFAIL ${name}\n  expected: ${JSON.stringify(want)}\n  actual:   ${JSON.stringify(got)}\n`);
    }
  }
  if (failed > 0) {
    process.stdout.write(`\nverify-api: ${failed} of ${current.checks.length} checks FAILED\n`);
    process.exit(1);
  }
  process.stdout.write(`verify-api: ${current.checks.length} checks passed, 0 failed\n`);
  process.stdout.write(`VERIFY-API: ALL PASS\n`);
}

main().catch((err) => {
  process.stderr.write(`verify-api: harness error — ${err?.stack ?? err}\n`);
  process.exit(1);
});
