import { parseCartridgeManifest } from '../cartridge/manifestSchema';
import {
  CATALOG_SCHEMA_VERSION,
  type Catalog,
  type CatalogAuthor,
  type CatalogEntry,
} from './types';

export interface CatalogValidationIssue {
  path: string;
  message: string;
}

export type CatalogValidationResult =
  | { valid: true; catalog: Catalog; issues: [] }
  | { valid: false; catalog?: undefined; issues: CatalogValidationIssue[] };

/**
 * Hand-rolled catalog validator. Mirrors `parseCartridgeManifest`'s style — no
 * Zod dependency, returns structured issues. Reuses `parseCartridgeManifest`
 * to validate each entry's embedded `manifest`.
 */
export function parseCatalog(raw: unknown): CatalogValidationResult {
  const issues: CatalogValidationIssue[] = [];

  if (!isObject(raw)) {
    return fail([{ path: '', message: 'catalog must be a JSON object' }]);
  }

  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== 'string' || schemaVersion.length === 0) {
    issues.push({ path: 'schemaVersion', message: 'schemaVersion must be a non-empty string' });
  }

  const updatedAt = optionalString(raw, 'updatedAt', issues);
  const signingKey = optionalString(raw, 'signingKey', issues);

  const rawEntries = raw.entries;
  if (!Array.isArray(rawEntries)) {
    issues.push({ path: 'entries', message: 'entries must be an array' });
    return fail(issues);
  }

  const entries: CatalogEntry[] = [];
  rawEntries.forEach((entry, index) => {
    const parsed = parseEntry(entry, `entries[${index}]`, issues);
    if (parsed) entries.push(parsed);
  });

  if (issues.length > 0) {
    return fail(issues);
  }

  const catalog: Catalog = {
    schemaVersion: schemaVersion as string,
    entries,
  };
  if (updatedAt !== undefined) catalog.updatedAt = updatedAt;
  if (signingKey !== undefined) catalog.signingKey = signingKey;

  return { valid: true, catalog, issues: [] };
}

function parseEntry(
  raw: unknown,
  path: string,
  issues: CatalogValidationIssue[],
): CatalogEntry | undefined {
  if (!isObject(raw)) {
    issues.push({ path, message: 'entry must be an object' });
    return undefined;
  }

  const before = issues.length;

  const id = requireString(raw, 'id', path, issues);
  const version = requireString(raw, 'version', path, issues);
  const name = requireString(raw, 'name', path, issues);
  const downloadUrl = requireString(raw, 'downloadUrl', path, issues);

  const downloadSizeBytes = raw.downloadSizeBytes;
  if (typeof downloadSizeBytes !== 'number' || !Number.isFinite(downloadSizeBytes) || downloadSizeBytes <= 0) {
    issues.push({
      path: `${path}.downloadSizeBytes`,
      message: 'downloadSizeBytes must be a positive number',
    });
  }

  const sha256 = raw.sha256;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) {
    issues.push({
      path: `${path}.sha256`,
      message: 'sha256 must be a 64-char hex string',
    });
  }

  const description = optionalString(raw, 'description', issues, path);
  const homepage = optionalString(raw, 'homepage', issues, path);
  const license = optionalString(raw, 'license', issues, path);
  const publishedAt = optionalString(raw, 'publishedAt', issues, path);
  const signature = optionalString(raw, 'signature', issues, path);

  const tags = optionalStringArray(raw, 'tags', path, issues);
  const categories = optionalStringArray(raw, 'categories', path, issues);

  let featured: boolean | undefined;
  if (raw.featured !== undefined) {
    if (typeof raw.featured !== 'boolean') {
      issues.push({ path: `${path}.featured`, message: 'featured must be a boolean when present' });
    } else {
      featured = raw.featured;
    }
  }

  const author = parseAuthor(raw.author, `${path}.author`, issues);

  const manifestResult = parseCartridgeManifest(raw.manifest);
  if (!manifestResult.valid) {
    for (const m of manifestResult.issues) {
      issues.push({
        path: m.path ? `${path}.manifest.${m.path}` : `${path}.manifest`,
        message: m.message,
      });
    }
  } else if (id !== undefined && manifestResult.manifest.id !== id) {
    issues.push({
      path: `${path}.manifest.id`,
      message: `manifest.id (${manifestResult.manifest.id}) must match entry.id (${id})`,
    });
  }

  if (issues.length > before) {
    return undefined;
  }

  const entry: CatalogEntry = {
    id: id as string,
    version: version as string,
    name: name as string,
    downloadUrl: downloadUrl as string,
    downloadSizeBytes: downloadSizeBytes as number,
    sha256: (sha256 as string).toLowerCase(),
    manifest: manifestResult.manifest!,
  };
  if (description !== undefined) entry.description = description;
  if (homepage !== undefined) entry.homepage = homepage;
  if (license !== undefined) entry.license = license;
  if (publishedAt !== undefined) entry.publishedAt = publishedAt;
  if (signature !== undefined) entry.signature = signature;
  if (tags !== undefined) entry.tags = tags;
  if (categories !== undefined) entry.categories = categories;
  if (featured !== undefined) entry.featured = featured;
  if (author !== undefined) entry.author = author;
  return entry;
}

function parseAuthor(
  raw: unknown,
  path: string,
  issues: CatalogValidationIssue[],
): CatalogAuthor | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    issues.push({ path, message: 'author must be an object when present' });
    return undefined;
  }
  if (typeof raw.name !== 'string' || raw.name.length === 0) {
    issues.push({ path: `${path}.name`, message: 'author.name must be a non-empty string' });
    return undefined;
  }
  const author: CatalogAuthor = { name: raw.name };
  if (raw.url !== undefined) {
    if (typeof raw.url !== 'string') {
      issues.push({ path: `${path}.url`, message: 'author.url must be a string when present' });
    } else {
      author.url = raw.url;
    }
  }
  if (raw.email !== undefined) {
    if (typeof raw.email !== 'string') {
      issues.push({ path: `${path}.email`, message: 'author.email must be a string when present' });
    } else {
      author.email = raw.email;
    }
  }
  return author;
}

function requireString(
  raw: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: CatalogValidationIssue[],
): string | undefined {
  const value = raw[key];
  if (typeof value !== 'string' || value.length === 0) {
    issues.push({ path: `${parentPath}.${key}`, message: `${key} must be a non-empty string` });
    return undefined;
  }
  return value;
}

function optionalString(
  raw: Record<string, unknown>,
  key: string,
  issues: CatalogValidationIssue[],
  parentPath = '',
): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    const path = parentPath ? `${parentPath}.${key}` : key;
    issues.push({ path, message: `${key} must be a string when present` });
    return undefined;
  }
  return value;
}

function optionalStringArray(
  raw: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: CatalogValidationIssue[],
): string[] | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    issues.push({
      path: `${parentPath}.${key}`,
      message: `${key} must be an array of strings when present`,
    });
    return undefined;
  }
  return value as string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(issues: CatalogValidationIssue[]): CatalogValidationResult {
  return { valid: false, issues };
}

export { CATALOG_SCHEMA_VERSION };
