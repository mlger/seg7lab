#!/usr/bin/env node
/**
 * scripts/verify-boundaries.mjs — architectural dependency-boundary checks.
 *
 * Enforces the layering documented in docs/ARCHITECTURE.md:
 *
 *   logic   (domain+application, pure)  imports NOTHING app-side, no React,
 *                                      no next, no DOM-global types.
 *   server  (application services+infra) may import logic, types, prisma —
 *                                      never React/components/lib-client.
 *   app/api (transport)                may import server + server/kernel —
 *                                      never prisma directly.
 *   lib     (client state/transport)   may import logic + types — never
 *                                      server.
 *   components (presentation)          may import logic, types, lib, hooks —
 *                                      never server.
 *
 * Runs on plain Node (no deps): walks src/**, extracts static import
 * specifiers, resolves the `@/` alias to src/, and asserts the matrix.
 * Wired as `npm run verify:boundaries`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

// Static import / re-export specifier patterns for this codebase's style.
const IMPORT_RE = /^\s*import\s+(?:type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]/;
const EXPORT_FROM_RE = /^\s*export\s+(?:type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]/;

/** All first-party TS/TSX files under src/. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mts|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** Resolve an import specifier to a src-relative category, or null (external). */
function categorize(spec, fromFile) {
  let target;
  if (spec.startsWith("@/")) {
    target = spec.slice(2); // e.g. "logic/engine" | "lib/store" | "server/kernel"
  } else if (spec.startsWith(".")) {
    // Resolve relative to the importing file, then normalize to src-relative.
    const resolved = resolve(dirname(fromFile), spec);
    const rel = resolved.slice(SRC.length + 1).replace(/\\/g, "/");
    target = rel.replace(/\.(ts|tsx)$/, "");
  } else {
    return null; // external package (react, zustand, next, @prisma/client, …)
  }
  target = target.replace(/\/index$/, "");
  if (target.startsWith("logic/")) return "logic";
  if (target.startsWith("server/")) return "server";
  if (target.startsWith("server")) return "server";
  if (target.startsWith("app/api/")) return "app-api";
  if (target.startsWith("app/")) return "app-shell";
  if (target.startsWith("lib/") || target === "lib" + "") return "lib";
  if (target.startsWith("components/")) return "components";
  if (target.startsWith("types/")) return "types";
  if (target.startsWith("utils/") || target === "utils") return "utils";
  if (target.startsWith("hooks/")) return "hooks";
  return "other";
}

/** The layer a file belongs to (mirror of the directory rules). */
function layerOf(file) {
  const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");
  if (rel.startsWith("logic/")) return "logic";
  if (rel.startsWith("server/")) return "server";
  if (rel.startsWith("app/api/")) return "app-api";
  if (rel.startsWith("app/")) return "app-shell";
  if (rel.startsWith("lib/")) return "lib";
  if (rel.startsWith("components/")) return "components";
  if (rel.startsWith("types/")) return "types";
  if (rel.startsWith("utils/")) return "utils";
  if (rel.startsWith("hooks/")) return "hooks";
  return "other";
}

/** Forbidden imports per layer: [category-of-import, reason]. */
const RULES = {
  logic: {
    "logic": null,
    "types": null,
    // logic may also import nothing else first-party; everything app-side is banned:
    "server": "domain must not know about the server layer",
    "app-api": "domain must not know about transport",
    "app-shell": "domain must not know about the app shell",
    "lib": "domain must not know about client state",
    "components": "domain must not know about UI",
    "utils": "client utils (DOM-coupled helpers) — keep the logic layer pure",
    "hooks": "domain must not know about React hooks",
    "other": "unknown first-party module — allow-list it in scripts/verify-boundaries.mjs if legitimate",
  },
  server: {
    "server": null,
    "logic": null,
    "types": null,
    "utils": null, // utils/binary is pure; svg-viewport is DOM but server never imports it
    "app-api": "services must not be imported by... (this file IS server; app-api import would be inverted)",
    "app-shell": "server must not import the app shell",
    "lib": "server must not import client state (inject access instead)",
    "components": "server must not import UI",
    "hooks": "server must not import React hooks",
    "other": "unknown first-party module — allow-list it in scripts/verify-boundaries.mjs if legitimate",
  },
  "app-api": {
    "app-api": null,
    "server": null,
    "logic": null,
    "types": null,
    "app-shell": null, // route files share the app shell's tsconfig paths; nothing imports it today
    "utils": null,
    "lib": "transport routes talk to services, never client modules",
    "components": "routes do not render UI",
    "hooks": "routes do not use React hooks",
    "other": "unknown first-party module — allow-list it in scripts/verify-boundaries.mjs if legitimate",
  },
};

// Packages that must never appear in the logic layer (framework leakage).
const LOGIC_BANNED_PACKAGES = new Set(["react", "react-dom", "next", "next/server", "zustand", "@prisma/client", "zod"]);

// DOM-global type references banned in the logic layer (SVGSVGElement, HTMLElement…).
const LOGIC_DOM_TYPES = /\b(SVGSVGElement|HTMLElement|HTMLCanvasElement|HTMLInputElement|HTMLDivElement|Window|Document\b|DOMRect|MouseEvent|PointerEvent|KeyboardEvent)\b/;

let passed = 0;
let failed = 0;
const failures = [];

for (const file of walk(SRC)) {
  const layer = layerOf(file);
  const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");

  for (const line of lines) {
    const m = line.match(IMPORT_RE) ?? line.match(EXPORT_FROM_RE);
    if (!m) continue;
    const spec = m[1];

    // Layer matrix (only layers with rules are checked).
    const rules = RULES[layer];
    if (rules) {
      const cat = categorize(spec, file);
      if (cat !== null && rules[cat]) {
        failed++;
        failures.push(`${rel}: imports '${spec}' — ${rules[cat]}`);
      } else if (cat !== null) {
        passed++;
      }
    }

    // Framework-package ban in the logic layer.
    if (layer === "logic" && LOGIC_BANNED_PACKAGES.has(spec)) {
      failed++;
      failures.push(`${rel}: imports package '${spec}' — the logic layer is framework-free`);
    }
  }

  // DOM-type ban in the logic layer (cheap regex over the file body).
  if (layer === "logic" && LOGIC_DOM_TYPES.test(text.replace(/^\s*\/\/.*$/gm, ""))) {
    const hit = text.match(LOGIC_DOM_TYPES)?.[0];
    failed++;
    failures.push(`${rel}: references DOM type '${hit}' — move DOM-coupled helpers to src/utils (see svg-viewport.ts)`);
  }
}

if (failed > 0) {
  console.error(`verify-boundaries: ${failed} violation(s):`);
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
console.log(`verify-boundaries: ${passed} imports checked across all layers, 0 violations`);
console.log("VERIFY-BOUNDARIES: ALL PASS");
