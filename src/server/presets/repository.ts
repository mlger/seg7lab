/**
 * Persistence contract for presets.
 *
 * Owned by the application layer: services depend on this interface, never
 * on Prisma. The Prisma implementation lives in ./prisma.ts; an in-memory
 * fake powers scripts/verify-services.ts.
 */

/** Valid preset kinds (mirrors the `kind` column / wire contract). */
export type PresetKind = "table" | "font";

/** A preset row as the application sees it. `data` only on full reads. */
export interface PresetRecord {
  id: string;
  kind: string;
  name: string;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Canonical JSON blob — absent in slim list reads. */
  data?: string;
}

/** Options for {@link PresetRepository.listVisible}. */
export interface PresetListOptions {
  /** Include the `data` blob column (slim lists skip it). */
  full: boolean;
  limit: number;
  offset: number;
}

/** Fields for {@link PresetRepository.create}. */
export interface PresetCreateInput {
  id: string;
  kind: PresetKind;
  name: string;
  /** Canonical JSON blob (validated + canonicalized upstream). */
  data: string;
  ownerId: string | null;
}

/** Mutable fields for {@link PresetRepository.update}. */
export interface PresetUpdateInput {
  name?: string;
  data?: string;
}

export interface PresetRepository {
  /**
   * Rows visible to `ownerId`: shared rows (ownerId = null) plus the owner's
   * own rows, newest first (updatedAt desc), paginated.
   */
  listVisible(ownerId: string | null, options: PresetListOptions): Promise<PresetRecord[]>;

  /** Full row (data included) by id, or null. No ownership filtering. */
  findById(id: string): Promise<PresetRecord | null>;

  /** Create a row; may throw a Prisma unique-constraint error (P2002). */
  create(input: PresetCreateInput): Promise<PresetRecord>;

  /** Update mutable fields; may throw P2025 when the row vanished. */
  update(id: string, fields: PresetUpdateInput): Promise<PresetRecord>;

  /** Delete by id; may throw P2025 when the row vanished. */
  remove(id: string): Promise<void>;
}
