import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AppError } from "../../lib/errors/index.js";
import { getEnv } from "../../config/env.js";

// ---------------------------------------------------------------------------
// Document storage adapter (Phase 6)
//
// Documents are NEVER stored in PostgreSQL. Object bytes live behind a small
// storage seam so a production object store (S3-compatible, etc.) can drop in
// with the same interface later. Phase 6 ships the dev-friendly local-disk
// adapter only.
//
// Security rules for keys: keys are always server-generated (organization
// UUID / deal UUID / document UUID / version), never client-derived. The
// adapter additionally verifies the resolved path stays inside the root, so a
// future caller can never write outside the bucket.
// ---------------------------------------------------------------------------

export interface StoredObjectInfo {
  sizeBytes: number;
  sha256: string;
}

export interface DocumentStorage {
  /** Stores `content` at `key`. Returns integrity metadata. */
  put(key: string, content: Buffer): Promise<StoredObjectInfo>;
  /** Reads the full object at `key`. Throws DOCUMENT_STORAGE_ERROR on ENOENT. */
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  /** Best-effort removal. Returns true when the object no longer exists. */
  delete(key: string): Promise<boolean>;
}

/** Development-grade filesystem adapter. NOT for production use. */
export class LocalDiskStorageAdapter implements DocumentStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolveKey(key: string): string {
    const normalized = key.replace(/[/\\]+/g, path.sep);
    const full = path.resolve(this.root, normalized);
    const relative = path.relative(this.root, full);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw AppError.documentStorageError("Invalid document storage key.");
    }
    return full;
  }

  async put(key: string, content: Buffer): Promise<StoredObjectInfo> {
    const file = this.resolveKey(key);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content);
    } catch (err) {
      throw AppError.documentStorageError(
        "The document could not be written to storage.",
        err,
      );
    }
    return {
      sizeBytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }

  async get(key: string): Promise<Buffer> {
    const file = this.resolveKey(key);
    try {
      return await fs.readFile(file);
    } catch (err) {
      const isMissing = (err as NodeJS.ErrnoException).code === "ENOENT";
      throw AppError.documentStorageError(
        isMissing
          ? "The document object is missing."
          : "The document could not be read.",
        err,
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    const file = this.resolveKey(key);
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    const file = this.resolveKey(key);
    try {
      await fs.rm(file, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}

function buildDocumentStorage(): DocumentStorage {
  // The root is resolved lazily and prefers the raw process env so tests can
  // pin a scratch directory without disturbing the (already-parsed) env cache.
  const explicitRoot = process.env.DOCUMENT_STORAGE_ROOT;
  const root =
    explicitRoot && explicitRoot.trim().length > 0
      ? path.resolve(explicitRoot)
      : getEnv().DOCUMENT_STORAGE_ROOT;

  const provider = getEnv().DOCUMENT_STORAGE_PROVIDER;
  switch (provider) {
    case "local-disk":
      return new LocalDiskStorageAdapter(root);
    default:
      throw new Error(`Unsupported document storage provider: ${provider}`);
  }
}

let sharedStorage: DocumentStorage | null = null;

export function documentStorage(force = false): DocumentStorage {
  if (sharedStorage === null || force) {
    sharedStorage = buildDocumentStorage();
  }
  return sharedStorage;
}

/** For tests: reset the cached adapter. */
export function resetDocumentStorage(): void {
  sharedStorage = null;
}

/** Server-generated storage key: org/deal/document/v<version>.<ext>. */
export function storageKeyFor(
  organizationId: string,
  dealId: string,
  documentId: string,
  version: number,
  ext: string,
): string {
  return `${organizationId}/${dealId}/${documentId}/v${version}.${ext}`;
}
