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

export function createS3ObjectStore(options: {
  bucket: string
  region: string
  endpoint?: string
  publicEndpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
}): ObjectStore {
  const local =
    options.endpoint && options.accessKeyId && options.secretAccessKey
      ? {
          endpoint: options.endpoint,
          forcePathStyle: true as const,
          credentials: {
            accessKeyId: options.accessKeyId,
            secretAccessKey: options.secretAccessKey,
          },
        }
      : undefined
  const client = new S3Client({
    region: options.region,
    ...local,
  })
  const signClient =
    local && options.publicEndpoint
      ? new S3Client({
          region: options.region,
          endpoint: options.publicEndpoint,
          forcePathStyle: true,
          credentials: local.credentials,
        })
      : client
  return {
    async presignPut(input) {
      return getSignedUrl(
        signClient,
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: input.key,
          ContentType: input.contentType,
        }),
        { expiresIn: presignSeconds },
      )
    },
    async presignGet(key) {
      return getSignedUrl(signClient, new GetObjectCommand({ Bucket: options.bucket, Key: key }), {
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
