import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  PresetCreateInput,
  PresetListOptions,
  PresetRecord,
  PresetRepository,
  PresetUpdateInput,
} from "./repository";

/**
 * Prisma implementation of the preset persistence contract.
 *
 * The ONLY server module that talks to `db.preset`. Slim lists select without
 * the data column so listing never loads blob columns.
 */

export class PrismaPresetRepository implements PresetRepository {
  constructor(private readonly prisma: Pick<PrismaClient, "preset">) {}

  async listVisible(
    ownerId: string | null,
    { full, limit, offset }: PresetListOptions
  ): Promise<PresetRecord[]> {
    const where: Prisma.PresetWhereInput = {
      OR: [{ ownerId: null }, ...(ownerId !== null ? [{ ownerId }] : [])],
    };
    const rows = full
      ? await this.prisma.preset.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: limit,
          skip: offset,
        })
      : await this.prisma.preset.findMany({
          where,
          select: {
            id: true,
            kind: true,
            name: true,
            ownerId: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          skip: offset,
        });
    return rows as PresetRecord[];
  }

  async findById(id: string): Promise<PresetRecord | null> {
    const row = await this.prisma.preset.findUnique({ where: { id } });
    return row as PresetRecord | null;
  }

  async create(input: PresetCreateInput): Promise<PresetRecord> {
    const row = await this.prisma.preset.create({
      data: {
        id: input.id,
        kind: input.kind,
        name: input.name,
        data: input.data,
        ...(input.ownerId !== null ? { ownerId: input.ownerId } : {}),
      },
    });
    return row as PresetRecord;
  }

  async update(id: string, fields: PresetUpdateInput): Promise<PresetRecord> {
    const row = await this.prisma.preset.update({ where: { id }, data: fields });
    return row as PresetRecord;
  }

  async remove(id: string): Promise<void> {
    await this.prisma.preset.delete({ where: { id } });
  }
}
