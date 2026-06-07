import type { CartridgeFileSystem } from './fileSystem';
import { CartridgeLoadError, loadCartridge } from './loadCartridge';
import type { LoadedCartridge } from './types';

/** Hash a byte array to lowercase hex sha256. Defaults to Web Crypto SubtleCrypto. */
export type CartridgeHasher = (bytes: Uint8Array) => Promise<string>;

export interface CartridgeValidationOptions {
  fs: CartridgeFileSystem;
  /** Defaults to Web Crypto SubtleCrypto (Node ≥19, browsers, modern RN). */
  hasher?: CartridgeHasher;
  /** Verify weights file sha256 against the manifest. Default: true. */
  verifySha256?: boolean;
  /** Verify projector file sha256 if its hash is embedded in manifest (future). Default: false. */
  verifyProjectorSha256?: boolean;
  /** Verify that weights.sizeBytes matches the on-disk file size. Default: true. */
  verifySize?: boolean;
}

export interface CartridgeValidationIssue {
  path: string;
  message: string;
}

export type CartridgeValidationResult =
  | { valid: true; cartridge: LoadedCartridge; issues: [] }
  | { valid: false; cartridge?: LoadedCartridge; issues: CartridgeValidationIssue[] };

export async function validateCartridge(
  rootDir: string,
  options: CartridgeValidationOptions,
): Promise<CartridgeValidationResult> {
  const { fs } = options;
  const verifySha256 = options.verifySha256 ?? true;
  const verifySize = options.verifySize ?? true;
  const hasher = options.hasher ?? defaultSha256Hasher;

  let cartridge: LoadedCartridge;
  try {
    cartridge = await loadCartridge(rootDir, { fs });
  } catch (error) {
    if (error instanceof CartridgeLoadError) {
      return {
        valid: false,
        issues:
          error.issues.length > 0
            ? error.issues
            : [{ path: '', message: error.message }],
      };
    }
    throw error;
  }

  const issues: CartridgeValidationIssue[] = [];

  if (verifySize) {
    const actualSize = await fs.fileSize(cartridge.weightsPath);
    if (actualSize !== cartridge.manifest.weights.sizeBytes) {
      issues.push({
        path: 'weights.sizeBytes',
        message: `declared ${cartridge.manifest.weights.sizeBytes} bytes but file is ${actualSize} bytes`,
      });
    }
  }

  if (verifySha256) {
    const bytes = await fs.readFileBytes(cartridge.weightsPath);
    const actual = (await hasher(bytes)).toLowerCase();
    const expected = cartridge.manifest.weights.sha256.toLowerCase();
    if (actual !== expected) {
      issues.push({
        path: 'weights.sha256',
        message: `declared ${expected} but computed ${actual}`,
      });
    }
  }

  if (issues.length > 0) {
    return { valid: false, cartridge, issues };
  }
  return { valid: true, cartridge, issues: [] };
}

interface SubtleCryptoLike {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}
interface CryptoLike {
  subtle?: SubtleCryptoLike;
}

const defaultSha256Hasher: CartridgeHasher = async (bytes) => {
  const cryptoRef = (globalThis as typeof globalThis & { crypto?: CryptoLike }).crypto;
  if (!cryptoRef || !cryptoRef.subtle) {
    throw new Error(
      'No SubtleCrypto available — pass `hasher` to validateCartridge for this environment.',
    );
  }
  const digest = await cryptoRef.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
};

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export { defaultSha256Hasher };
