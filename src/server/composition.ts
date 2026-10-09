import { db } from "./db";
import { PrismaProjectRepository } from "./projects/prisma";
import { createProjectService, type ProjectService } from "./projects/service";
import { PrismaPresetRepository } from "./presets/prisma";
import { createPresetService, type PresetService } from "./presets/service";

/**
 * Composition root for the server layer.
 *
 * The single place where concrete infrastructure (Prisma repositories) is
 * wired into application services. Route handlers call the memoized getters
 * below; tests build services directly against in-memory repositories
 * instead (scripts/verify-services.ts). Swapping the persistence engine
 * (see docs/decisions/0007) means adding one adapter here.
 */

let projectService: ProjectService | undefined;
let presetService: PresetService | undefined;

/** Project use cases bound to the Prisma repository (memoized). */
export function getProjectService(): ProjectService {
  return (projectService ??= createProjectService(new PrismaProjectRepository(db)));
}

/** Preset use cases bound to the Prisma repository (memoized). */
export function getPresetService(): PresetService {
  return (presetService ??= createPresetService(new PrismaPresetRepository(db)));
}
