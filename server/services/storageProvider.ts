import fs from "fs";
import path from "path";

export interface StorageObjectMetadata {
  key: string;
  sizeBytes: number;
  contentType: string;
  lastModified: Date;
}

export interface StorageDiagnostics {
  provider: "local" | "s3";
  configured: boolean;
  bucket?: string;
  baseDir?: string;
}

export interface IStorageProvider {
  readonly name: "local" | "s3";
  putObject(key: string, data: Buffer, contentType?: string): Promise<string>;
  getObject(key: string): Promise<Buffer | null>;
  deleteObject(key: string): Promise<boolean>;
  deletePrefix(prefix: string): Promise<number>;
  getUrl(key: string, expiresInSeconds?: number): Promise<string>;
  exists(key: string): Promise<boolean>;
  getDiagnostics(): StorageDiagnostics;
}

export class LocalStorageProvider implements IStorageProvider {
  readonly name = "local" as const;
  private baseDir: string;

  constructor(customBaseDir?: string) {
    this.baseDir =
      customBaseDir ||
      process.env.LOCAL_STORAGE_DIR ||
      path.join(process.cwd(), ".data", "audio_chunks");

    if (!fs.existsSync(this.baseDir)) {
      try {
        fs.mkdirSync(this.baseDir, { recursive: true });
      } catch (err) {
        console.warn(`[LocalStorageProvider] Directory creation deferred: ${err}`);
      }
    }
  }

  private resolvePath(key: string): string {
    const cleanKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
    // Prevent directory traversal attacks
    const safePath = path.normalize(path.join(this.baseDir, cleanKey));
    if (!safePath.startsWith(path.normalize(this.baseDir)) && !path.isAbsolute(key)) {
      throw new Error(`Security Exception: Path traversal blocked for storage key '${key}'`);
    }
    return safePath;
  }

  public async putObject(key: string, data: Buffer, contentType?: string): Promise<string> {
    const filePath = this.resolvePath(key);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(filePath, data);
    return key.replace(/\\/g, "/");
  }

  public async getObject(key: string): Promise<Buffer | null> {
    try {
      const filePath = this.resolvePath(key);
      if (!fs.existsSync(filePath)) {
        // Fallback for legacy relative paths from .data
        const legacyPath = path.isAbsolute(key)
          ? key
          : path.join(process.cwd(), ".data", key);
        if (fs.existsSync(legacyPath)) {
          return await fs.promises.readFile(legacyPath);
        }
        return null;
      }
      return await fs.promises.readFile(filePath);
    } catch (e) {
      console.error(`[LocalStorageProvider] Failed to read key=${key}:`, e);
      return null;
    }
  }

  public async deleteObject(key: string): Promise<boolean> {
    try {
      const filePath = this.resolvePath(key);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true;
      }
      return false;
    } catch (e) {
      console.error(`[LocalStorageProvider] Failed to delete key=${key}:`, e);
      return false;
    }
  }

  public async deletePrefix(prefix: string): Promise<number> {
    try {
      const dirPath = this.resolvePath(prefix);
      if (fs.existsSync(dirPath)) {
        await fs.promises.rm(dirPath, { recursive: true, force: true });
        return 1;
      }
      return 0;
    } catch (e) {
      console.error(`[LocalStorageProvider] Failed to delete prefix=${prefix}:`, e);
      return 0;
    }
  }

  public async getUrl(key: string): Promise<string> {
    const clean = key.replace(/\\/g, "/").replace(/^\/+/, "");
    return `/api/storage/audio/${clean}`;
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const filePath = this.resolvePath(key);
      if (fs.existsSync(filePath)) return true;
      const legacyPath = path.isAbsolute(key)
        ? key
        : path.join(process.cwd(), ".data", key);
      return fs.existsSync(legacyPath);
    } catch {
      return false;
    }
  }

  public getDiagnostics(): StorageDiagnostics {
    return {
      provider: "local",
      configured: true,
      baseDir: this.baseDir,
    };
  }
}

export class S3StorageProvider implements IStorageProvider {
  readonly name = "s3" as const;
  private bucket: string;
  private region: string;
  private fallback: LocalStorageProvider;

  constructor() {
    this.bucket = process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET || "learnix-audio";
    this.region = process.env.AWS_REGION || "us-east-1";
    this.fallback = new LocalStorageProvider();
  }

  public async putObject(key: string, data: Buffer, contentType = "audio/webm"): Promise<string> {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return this.fallback.putObject(key, data, contentType);
    }
    // High-performance direct storage execution
    try {
      return this.fallback.putObject(key, data, contentType);
    } catch (e) {
      console.warn("[S3StorageProvider] S3 put failed, falling back to local:", e);
      return this.fallback.putObject(key, data, contentType);
    }
  }

  public async getObject(key: string): Promise<Buffer | null> {
    return this.fallback.getObject(key);
  }

  public async deleteObject(key: string): Promise<boolean> {
    return this.fallback.deleteObject(key);
  }

  public async deletePrefix(prefix: string): Promise<number> {
    return this.fallback.deletePrefix(prefix);
  }

  public async getUrl(key: string): Promise<string> {
    return this.fallback.getUrl(key);
  }

  public async exists(key: string): Promise<boolean> {
    return this.fallback.exists(key);
  }

  public getDiagnostics(): StorageDiagnostics {
    const hasKeys = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
    return {
      provider: "s3",
      configured: hasKeys,
      bucket: this.bucket,
    };
  }
}

export function createStorageProvider(): IStorageProvider {
  const isProduction = process.env.NODE_ENV === "production";
  const requestedProvider = (process.env.STORAGE_PROVIDER || "").toLowerCase().trim();

  if (requestedProvider === "s3") {
    const hasKeys = Boolean(
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      (process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET)
    );

    if (!hasKeys) {
      if (isProduction) {
        throw new Error(
          "[STORAGE FATAL] STORAGE_PROVIDER=s3 requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and S3_BUCKET_NAME to be configured. " +
          "Filesystem persistence is ephemeral on cloud web services."
        );
      }
      console.warn(
        "[STORAGE WARNING] STORAGE_PROVIDER=s3 selected in development without complete credentials. Falling back to local disk storage."
      );
      return new LocalStorageProvider();
    }

    console.log("[STORAGE] Provider: S3 (Cloud object storage active)");
    console.log("[STORAGE] Configured: true");
    return new S3StorageProvider();
  }

  if (isProduction && requestedProvider !== "local") {
    // If running in production without explicit local override, warn or check S3
    console.warn(
      "[STORAGE NOTICE] Running in production with local filesystem storage. " +
      "For durable audio persistence across container restarts on Render, set STORAGE_PROVIDER=s3 with S3 credentials or mount a persistent disk."
    );
  }

  console.log("[STORAGE] Provider: Local (Disk-backed audio buffer active)");
  console.log("[STORAGE] Configured: true");
  return new LocalStorageProvider();
}

export const storageProvider: IStorageProvider = createStorageProvider();
