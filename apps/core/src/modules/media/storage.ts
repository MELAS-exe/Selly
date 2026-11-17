// Object storage for images and voice notes (architecture.md sections 3.5 and 8.6).
// - private bucket: what vendors and the agent upload (originals, voice notes). Never public; read by core, and by
//   the agent through short presigned links.
// - public bucket: the re-encoded product images, served by the CDN.
// S3ObjectStore talks to any S3-compatible service (MinIO locally). MemoryObjectStore serves tests and development.
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../../config';

export type Bucket = 'public' | 'private';

export interface ObjectStore {
  /**
   * A URL the browser PUTs the bytes to. Content type and length are signed: a different type or size is refused
   * by the storage service itself.
   */
  presignPut(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string> }>;
  /** A short-lived link to read a private object, for the agent's vision model. */
  presignGet(key: string, expiresSeconds: number): Promise<string>;
  /** Null when the object does not exist. */
  get(bucket: Bucket, key: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  /** Size and type without the bytes; null when the object does not exist. */
  head(bucket: Bucket, key: string): Promise<{ sizeBytes: number; contentType: string } | null>;
  put(
    bucket: Bucket,
    key: string,
    bytes: Buffer,
    contentType: string,
    cacheControl?: string,
  ): Promise<void>;
  delete(bucket: Bucket, key: string): Promise<void>;
}

const notFound = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404;
};

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  /** Signs browser URLs with the address the browser can reach (http://localhost:9000 next to http://minio:9000). */
  private readonly presigner: S3Client;

  constructor(private readonly config: Config) {
    const base = {
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    };
    this.client = new S3Client({ ...base, endpoint: config.S3_ENDPOINT });
    this.presigner = new S3Client({
      ...base,
      endpoint: config.S3_PRESIGN_ENDPOINT || config.S3_ENDPOINT,
    });
  }

  private bucket(b: Bucket) {
    return b === 'public' ? this.config.S3_BUCKET_PUBLIC : this.config.S3_BUCKET_PRIVATE;
  }

  async presignPut(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresSeconds: number;
  }) {
    const url = await getSignedUrl(
      this.presigner,
      new PutObjectCommand({
        Bucket: this.bucket('private'),
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes,
      }),
      {
        expiresIn: input.expiresSeconds,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return { url, headers: { 'content-type': input.contentType } };
  }

  presignGet(key: string, expiresSeconds: number) {
    return getSignedUrl(
      this.presigner,
      new GetObjectCommand({ Bucket: this.bucket('private'), Key: key }),
      { expiresIn: expiresSeconds },
    );
  }

  async get(bucket: Bucket, key: string) {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket(bucket), Key: key }),
      );
      const bytes = Buffer.from(
        await (res.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray(),
      );
      return { bytes, contentType: res.ContentType ?? 'application/octet-stream' };
    } catch (err) {
      if (notFound(err)) return null;
      throw err;
    }
  }

  async head(bucket: Bucket, key: string) {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket(bucket), Key: key }),
      );
      return {
        sizeBytes: res.ContentLength ?? 0,
        contentType: res.ContentType ?? 'application/octet-stream',
      };
    } catch (err) {
      if (notFound(err)) return null;
      throw err;
    }
  }

  async put(
    bucket: Bucket,
    key: string,
    bytes: Buffer,
    contentType: string,
    cacheControl?: string,
  ) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket(bucket),
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ...(cacheControl ? { CacheControl: cacheControl } : {}),
      }),
    );
  }

  async delete(bucket: Bucket, key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(bucket), Key: key }));
  }
}

/** In memory, for tests and for development without MinIO. Presigned URLs point nowhere: tests call put(). */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Buffer; contentType: string }>();
  readonly signed: { key: string; contentType: string; sizeBytes: number }[] = [];

  async presignPut(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresSeconds: number;
  }) {
    this.signed.push(input);
    return {
      url: `https://storage.invalid/private/${input.key}?expires=${input.expiresSeconds}`,
      headers: { 'content-type': input.contentType },
    };
  }

  async presignGet(key: string, expiresSeconds: number) {
    return `https://storage.invalid/private/${key}?expires=${expiresSeconds}`;
  }

  async get(bucket: Bucket, key: string) {
    return this.objects.get(`${bucket}/${key}`) ?? null;
  }

  async head(bucket: Bucket, key: string) {
    const o = this.objects.get(`${bucket}/${key}`);
    return o ? { sizeBytes: o.bytes.length, contentType: o.contentType } : null;
  }

  async put(bucket: Bucket, key: string, bytes: Buffer, contentType: string) {
    this.objects.set(`${bucket}/${key}`, { bytes, contentType });
  }

  async delete(bucket: Bucket, key: string) {
    this.objects.delete(`${bucket}/${key}`);
  }
}

export function objectStoreFromConfig(config: Config): ObjectStore {
  return config.MEDIA_STORE === 's3' ? new S3ObjectStore(config) : new MemoryObjectStore();
}
