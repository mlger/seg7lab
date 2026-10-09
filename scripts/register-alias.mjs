/**
 * Minimal resolver hook so scripts/verify-logic.ts (which imports via the
 * `@/…` tsconfig path alias) can run under plain Node:
 *
 *     npm run verify:logic:node
 *
 * Bun resolves `paths` natively, so this file is only used by the Node path.
 */
import { register } from 'node:module';

register('./alias-hooks.mjs', import.meta.url);
