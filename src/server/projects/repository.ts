/**
 * Persistence contract for projects.
 *
 * Owned by the application layer: services depend on this interface, never
 * on Prisma. The Prisma implementation lives in ./prisma.ts; an in-memory
 * fake powers scripts/verify-services.ts. Row shape is persistence-neutral
 * (Dates, `data` present only on full reads — mirroring the slim/full select
 * distinction so listing never loads blob columns).
 */

/** A project row as the application sees it. `data` only on full reads. */
export interface ProjectRecord {
  id: string;
  name: string;
  inputBits: number;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Canonical JSON blob — absent in slim list reads. */
  data?: string;
}

/** Options for {@link ProjectRepository.listVisible}. */
export interface ProjectListOptions {
  /** Include the `data` blob column (slim lists skip it). */
  full: boolean;
  limit: number;
  offset: number;
}

/** Fields for {@link ProjectRepository.create}. */
export interface ProjectCreateInput {
  /** Client-supplied id (offline push-up) or absent for a server cuid. */
  id?: string;
  name: string;
  inputBits: number;
  /** Canonical JSON blob (validated + canonicalized upstream). */
  data: string;
  ownerId: string | null;
}

/** Mutable fields for {@link ProjectRepository.update}. */
export interface ProjectUpdateInput {
  name?: string;
  inputBits?: number;
  data?: string;
}

export interface ProjectRepository {
  /**
   * Rows visible to `ownerId`: shared rows (ownerId = null) plus the owner's
   * own rows, newest first (updatedAt desc), paginated. This visibility rule
   * is a business rule expressed here as the contract of the method.
   */
  listVisible(ownerId: string | null, options: ProjectListOptions): Promise<ProjectRecord[]>;

  /** Full row (data included) by id, or null. No ownership filtering. */
  findById(id: string): Promise<ProjectRecord | null>;

  /** Create a row; may throw a Prisma unique-constraint error (P2002). */
  create(input: ProjectCreateInput): Promise<ProjectRecord>;

  /** Update mutable fields; may throw P2025 when the row vanished. */
  update(id: string, fields: ProjectUpdateInput): Promise<ProjectRecord>;

  /** Delete by id; may throw P2025 when the row vanished. */
  remove(id: string): Promise<void>;
}
