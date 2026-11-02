import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Request, Response } from "express";
import config from "../config";
import logger from "../utils/logger";

export interface StoredObject {
  key: string;
  bucket: string;
  storage: "S3" | "LOCAL";
}

const LOCAL_BUCKET = "local";

// HMAC key for local download links, derived from the JWT secret so no extra
// setting is needed and a link cannot be forged without the server's secret.
const linkKey = crypto.createHash("sha256").update(`local-files:${config.JWT_SECRET}`).digest();

const signLocal = (key: string, expires: number): string =>
  crypto.createHmac("sha256", linkKey).update(`${key}\n${expires}`).digest("base64url");

// S3-backed object storage with a local-disk driver for development. Set
// AWS_S3_BUCKET to use S3 (credentials from AWS_S3_ACCESS_KEY/SECRET_KEY when
// set, else the default AWS chain; AWS_ENDPOINT_URL points it at an emulator).
class StorageService {
  private s3: S3Client | null = null;
  private bucket = config.AWS_S3_BUCKET;

  constructor() {
    if (this.bucket) {
      const explicit =
        config.AWS_S3_ACCESS_KEY && config.AWS_S3_SECRET_KEY
          ? {
              credentials: {
                accessKeyId: config.AWS_S3_ACCESS_KEY,
                secretAccessKey: config.AWS_S3_SECRET_KEY,
              },
            }
          : {};
      this.s3 = new S3Client({
        region: config.AWS_REGION,
        ...explicit,
        ...(config.AWS_ENDPOINT_URL
          ? { endpoint: config.AWS_ENDPOINT_URL, forcePathStyle: true }
          : {}),
      });
      logger.info(`Storage: S3 bucket ${this.bucket}`);
    } else {
      logger.info(`Storage: local disk at ${config.LOCAL_STORAGE_DIR}`);
    }
  }

  isS3Enabled(): boolean {
    return this.s3 !== null;
  }

  async upload(params: {
    key: string;
    body: Buffer;
    contentType?: string;
  }): Promise<StoredObject> {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: params.key,
          Body: params.body,
          ContentType: params.contentType,
        })
      );
      return { key: params.key, bucket: this.bucket, storage: "S3" };
    }

    const filePath = localPath(params.key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, params.body);
    return { key: params.key, bucket: LOCAL_BUCKET, storage: "LOCAL" };
  }

  // Returns a browser-usable, expiring URL: a presigned S3 URL, or a signed
  // link to the API's /local-files route for the local driver.
  async getDownloadUrl(key: string, expiresInSec = 3600): Promise<string> {
    if (this.s3) {
      const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
      return getSignedUrl(this.s3, command, { expiresIn: expiresInSec });
    }
    const expires = Math.floor(Date.now() / 1000) + expiresInSec;
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    return `${config.APP_PUBLIC_URL}/local-files/${encoded}?expires=${expires}&sig=${signLocal(key, expires)}`;
  }

  async delete(key: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      return;
    }
    await fs.rm(localPath(key), { force: true });
  }
}

/** Resolves a storage key under the local root, refusing any path escape. */
function localPath(key: string): string {
  const root = path.resolve(config.LOCAL_STORAGE_DIR);
  const full = path.resolve(root, key);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("invalid storage key");
  return full;
}

/** GET /local-files/*key?expires=&sig= : serves a file only for a valid, unexpired link. */
export async function serveLocalFile(req: Request, res: Response): Promise<void> {
  const raw = (req.params as Record<string, string | string[]>).key;
  const key = Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
  const expires = Number(req.query.expires);
  const sig = String(req.query.sig ?? "");
  const expected = signLocal(key, expires);
  const valid =
    Number.isFinite(expires) &&
    expires * 1000 > Date.now() &&
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid) {
    res.status(403).json({ success: false, message: "Link expired or invalid", statusCode: 403 });
    return;
  }
  let file: string;
  try {
    file = localPath(key);
  } catch {
    res.status(404).end();
    return;
  }
  res.setHeader("Cache-Control", "private, max-age=300");
  res.sendFile(file, { dotfiles: "allow" }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
}

export default new StorageService();
