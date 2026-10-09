import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  // Layer rules (see docs/ARCHITECTURE.md + scripts/verify-boundaries.mjs,
  // which is the authoritative check wired as `npm run verify:boundaries`).
  files: ["src/logic/**"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["react", "react-dom", "react/*", "next", "next/*", "zustand", "@prisma/client"],
        message: "The logic layer (domain) is framework-free — no React/Next/state/ORM imports.",
      }],
    }],
  },
}, {
  files: ["src/app/api/**"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["@prisma/client", "@/server/db", "@/lib/db"],
        message: "Routes are transport only — obtain persistence through the service layer (src/server/composition.ts).",
      }],
    }],
  },
}, {
  files: ["src/lib/**", "src/components/**", "src/hooks/**", "src/app/**"],
  ignores: ["src/app/api/**"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["@/server/*", "@/server"],
        message: "Client code never imports the server layer — go through the REST API (src/lib/api-client.ts).",
      }],
    }],
  },
}, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills"]
}];

export default eslintConfig;
