import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env, isR2Configured } from '../config/env.ts';

function getR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.r2.accessKeyId,
      secretAccessKey: env.r2.secretAccessKey,
    },
  });
}

export async function createPresignedUploadUrl(params: {
  objectKey: string;
  contentType: string;
}): Promise<{ uploadUrl: string; objectKey: string; expiresInSeconds: number }> {
  if (!isR2Configured()) {
    throw new Error('Cloudflare R2 storage is not configured.');
  }
  const client = getR2Client();
  const expiresInSeconds = 300;
  const command = new PutObjectCommand({
    Bucket: env.r2.bucketName,
    Key: params.objectKey,
    ContentType: params.contentType,
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  return { uploadUrl, objectKey: params.objectKey, expiresInSeconds };
}

export async function createPresignedDownloadUrl(params: {
  objectKey: string;
}): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
  if (!isR2Configured()) {
    throw new Error('Cloudflare R2 storage is not configured.');
  }
  const client = getR2Client();
  const expiresInSeconds = 900;
  const command = new GetObjectCommand({
    Bucket: env.r2.bucketName,
    Key: params.objectKey,
  });
  const downloadUrl = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  return { downloadUrl, expiresInSeconds };
}
