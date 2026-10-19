import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const photoContentTypes = ['image/jpeg', 'image/png', 'image/webp'] as const
export const maxPhotoBytes = 10 * 1024 * 1024
export const presignSeconds = 300

export type ObjectStore = {
  presignPut(input: { key: string; contentType: string; byteSize: number }): Promise<string>
  presignGet(key: string): Promise<string>
  put(input: { key: string; body: Uint8Array; contentType: string }): Promise<void>
}

export function createS3ObjectStore(options: { bucket: string; region: string }): ObjectStore {
  const client = new S3Client({ region: options.region })
  return {
    async presignPut(input) {
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: input.key,
          ContentType: input.contentType,
          ContentLength: input.byteSize,
        }),
        { expiresIn: presignSeconds },
      )
    },
    async presignGet(key) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: options.bucket, Key: key }), {
        expiresIn: presignSeconds,
      })
    },
    async put(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }),
      )
    },
  }
}

export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>()

  async presignPut(input: { key: string }): Promise<string> {
    return `https://files.local/upload/${encodeURIComponent(input.key)}`
  }

  async presignGet(key: string): Promise<string> {
    return `https://files.local/read/${encodeURIComponent(key)}`
  }

  async put(input: { key: string; body: Uint8Array; contentType: string }): Promise<void> {
    this.objects.set(input.key, { body: input.body, contentType: input.contentType })
  }
}
