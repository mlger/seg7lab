import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  ProjectCreateInput,
  ProjectListOptions,
  ProjectRecord,
  ProjectRepository,
  ProjectUpdateInput,
} from "./repository";

/**
 * Prisma implementation of the project persistence contract.
 *
 * The ONLY server module that talks to `db.project`. Slim lists use a
 * `select` without the data column so listing never loads blob columns —
 * that performance decision is an implementation detail of this adapter and
 * invisible to the service layer.
 */

/** Shape of rows this adapter returns in slim mode. */
type SlimRow = {
  id: string;
  name: string;
  inputBits: number;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly prisma: Pick<PrismaClient, "project">) {}

  async listVisible(
    ownerId: string | null,
    { full, limit, offset }: ProjectListOptions
  ): Promise<ProjectRecord[]> {
    const where: Prisma.ProjectWhereInput = {
      OR: [{ ownerId: null }, ...(ownerId !== null ? [{ ownerId }] : [])],
    };
    const rows = full
      ? await this.prisma.project.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: limit,
          skip: offset,
        })
      : await this.prisma.project.findMany({
          where,
          select: {
            id: true,
            name: true,
            inputBits: true,
            ownerId: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          skip: offset,
        });
    return rows as ProjectRecord[];
  }

  async findById(id: string): Promise<ProjectRecord | null> {
    const row = await this.prisma.project.findUnique({ where: { id } });
    return row as ProjectRecord | null;
  }

  async create(input: ProjectCreateInput): Promise<ProjectRecord> {
    const row = await this.prisma.project.create({
      data: {
        ...(input.id !== undefined ? { id: input.id } : {}),
        name: input.name,
        inputBits: input.inputBits,
        data: input.data,
        ...(input.ownerId !== null ? { ownerId: input.ownerId } : {}),
      },
    });
    return row as ProjectRecord;
  }

  async update(id: string, fields: ProjectUpdateInput): Promise<ProjectRecord> {
    const row = await this.prisma.project.update({ where: { id }, data: fields });
    return row as ProjectRecord;
  }

  async remove(id: string): Promise<void> {
    await this.prisma.project.delete({ where: { id } });
  }
}

// Re-export so adapters/consumers share one import surface if needed.
export type { SlimRow };
