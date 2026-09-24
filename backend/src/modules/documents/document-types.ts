import { AppError } from "../../lib/errors/index.js";

// ---------------------------------------------------------------------------
// Document type catalog (Phase 6)
//
// `documentType` is stored as a plain string column (NOT a database enum) and
// validated against this catalog at the boundary, so adding a new document
// type never requires a migration. Each type declares the file extensions it
// accepts; the upload path cross-checks the extension AND the magic bytes.
//
// Limitation (documented): OOXML formats (.docx/.xlsx/.pptx) all share the
// same ZIP magic (`PK\x03\x04`), so content sniffing cannot distinguish one
// zip-based format from another — the extension + declared MIME are the
// stronger signal there, and this is intentionally documented in the README.
// ---------------------------------------------------------------------------

export interface DocumentTypeSpec {
  label: string;
  extensions: readonly string[];
}

export const DOCUMENT_TYPE_CATALOG: Readonly<Record<string, DocumentTypeSpec>> =
  {
    KYC_PASSPORT: {
      label: "KYC passport",
      extensions: ["pdf", "png", "jpg"],
    },
    KYC_COMPANY_CERTIFICATE: {
      label: "KYC company certificate",
      extensions: ["pdf", "png", "jpg"],
    },
    BUSINESS_REGISTRATION: {
      label: "Business registration",
      extensions: ["pdf", "docx", "xlsx", "png", "jpg"],
    },
    AUDITED_FINANCIALS: {
      label: "Audited financials",
      extensions: ["pdf", "xlsx", "docx"],
    },
    BANK_STATEMENT: {
      label: "Bank statement",
      extensions: ["pdf", "xlsx"],
    },
    TAX_CERTIFICATE: {
      label: "Tax certificate",
      extensions: ["pdf", "png", "jpg"],
    },
    CONTRACT: {
      label: "Contract",
      extensions: ["pdf", "docx"],
    },
    GENERAL: {
      label: "General document",
      extensions: ["pdf", "png", "jpg", "docx", "xlsx"],
    },
  } as const;

export type DocumentTypeId = keyof typeof DOCUMENT_TYPE_CATALOG;

export const DOCUMENT_TYPE_IDS = Object.keys(
  DOCUMENT_TYPE_CATALOG,
) as DocumentTypeId[];

export const DOCUMENT_VISIBILITY_VALUES = [
  "PRIVATE",
  "PARTICIPANTS",
  "DEAL_OWNER",
  "SPECIFIC_PARTICIPANTS",
] as const;

export type DocumentVisibilityValue =
  (typeof DOCUMENT_VISIBILITY_VALUES)[number];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Maps a canonical extension to a magic-byte check for the content. */
const EXTENSION_MAGIC: Readonly<Record<string, (b: Buffer) => boolean>> = {
  pdf: (b) => b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-",
  png: (b) =>
    b.length >= PNG_MAGIC.length &&
    b.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC),
  jpg: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  docx: (b) =>
    b.length >= 4 &&
    b[0] === 0x50 &&
    b[1] === 0x4b &&
    b[2] === 0x03 &&
    b[3] === 0x04,
  xlsx: (b) =>
    b.length >= 4 &&
    b[0] === 0x50 &&
    b[1] === 0x4b &&
    b[2] === 0x03 &&
    b[3] === 0x04,
};

const ALLOWED_EXTENSIONS = new Set(Object.keys(EXTENSION_MAGIC));

/** Canonicalize `jpeg`/`jpg` to `jpg`; lowercase everything else. */
function canonicalExtension(ext: string): string {
  const lower = ext.toLowerCase();
  return lower === "jpeg" ? "jpg" : lower;
}

export function isAllowedExtension(ext: string): boolean {
  return ALLOWED_EXTENSIONS.has(canonicalExtension(ext));
}

/**
 * Extracts the file extension from a client filename (the portion after the
 * final dot), lowercased and canonicalized. Returns null when the name has no
 * extension or the extension is empty/positioned at the start.
 */
export function extensionFromFilename(filename: string): string | null {
  const name = filename.trim();
  if (name.length === 0 || name.length > 255) return null;
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const base = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = canonicalExtension(base.slice(dot + 1));
  return ALLOWED_EXTENSIONS.has(ext) ? ext : null;
}

/** The storage-side canonical extension for a validated upload. */
export function canonicalExtensionFor(ext: string): string {
  return canonicalExtension(ext);
}

/** Throws DOCUMENT_TYPE_NOT_ALLOWED unless `ext` is a permitted type file. */
export function assertExtensionAllowedForType(
  ext: string,
  documentType: string,
): void {
  const spec = DOCUMENT_TYPE_CATALOG[documentType];
  if (!spec) {
    throw AppError.documentTypeNotAllowed(
      `Document type "${documentType}" is not supported.`,
    );
  }
  if (!spec.extensions.includes(canonicalExtension(ext))) {
    throw AppError.documentTypeNotAllowed(
      `.${ext} files are not accepted for ${documentType} documents.`,
    );
  }
}

/** Throws DOCUMENT_UPLOAD_INVALID when the buffer does not match `ext`. */
export function assertMagicMatches(buffer: Buffer, ext: string): void {
  const check = EXTENSION_MAGIC[canonicalExtension(ext)];
  if (!check) {
    throw AppError.documentTypeNotAllowed(`.${ext} is not an accepted format.`);
  }
  if (!check(buffer)) {
    throw AppError.documentUploadInvalid(
      `File content does not match the declared .${ext} type.`,
    );
  }
}
