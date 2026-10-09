/**
 * Node module-resolution hook mapping the `@/…` tsconfig alias onto ./src
 * (plus extensionless TS specifiers), so the verification script runs under
 * plain Node with --experimental-strip-types. Paired with register-alias.mjs.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Add `.ts` / `/index.ts` when the specifier has no extension. */
function withTsExtension(absPath) {
  if (path.extname(absPath)) return absPath;
  for (const candidate of [`${absPath}.ts`, path.join(absPath, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return absPath;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = withTsExtension(path.join(srcRoot, specifier.slice(2)));
    return { url: pathToFileURL(target).href, shortCircuit: true };
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    // Relative TS imports inside src/ (extensionless) need the same treatment.
    const parent = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
    const abs = path.resolve(parent, specifier);
    if (!path.extname(abs) && (existsSync(`${abs}.ts`) || existsSync(path.join(abs, 'index.ts')))) {
      return { url: pathToFileURL(withTsExtension(abs)).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
