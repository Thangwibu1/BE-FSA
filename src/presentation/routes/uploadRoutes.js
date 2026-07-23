import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as MinioClient } from 'minio';
import { ValidationError } from '../../shared/errors.js';
import { bearerSecurity, errorResponses } from '../schemas/openApiSchemas.js';

const EXTENSIONS = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
});

const VIDEO_EXTENSIONS = Object.freeze({
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogg',
  'video/quicktime': '.mov',
});

export function registerUploadRoutes(fastify, auth, uploadConfig, minioConfig) {
  // --- Upload Image ---
  fastify.post('/uploads/images', {
    preHandler: auth.authorize('ADMIN'),
    schema: {
      tags: ['Uploads'],
      operationId: 'uploadImage',
      summary: 'Upload an image used by a movie, employee or promotion',
      description: `ADMIN only. Accepts exactly one non-empty JPEG, PNG, WEBP, or GIF file up to ${uploadConfig.maxImageBytes} bytes and returns its public URL.`,
      security: bearerSecurity,
      consumes: ['multipart/form-data'],
      response: {
        201: {
          description: 'The image was stored and is available from the returned URL.',
          type: 'object',
          additionalProperties: false,
          required: ['url'],
          properties: {
            url: { type: 'string', format: 'uri', example: 'http://localhost:3000/uploads/2fc10a6f-ef1f-40d9-a783-13e69c9055b0.jpg' },
          },
        },
        ...errorResponses(400, 401, 403),
      },
    },
  }, async (request, reply) => {
    const part = await request.file();
    if (!part) throw new ValidationError('Image file is required');
    const extension = EXTENSIONS[part.mimetype];
    if (!extension) throw new ValidationError('Only JPEG, PNG, WEBP or GIF images are allowed');

    let data;
    try {
      data = await part.toBuffer();
    } catch (error) {
      if (error?.code === 'FST_REQ_FILE_TOO_LARGE') throw new ValidationError('Image exceeds the upload size limit');
      throw error;
    }
    if (data.length === 0) throw new ValidationError('Image file is empty');
    if (data.length > uploadConfig.maxImageBytes) throw new ValidationError('Image exceeds the upload size limit');

    await mkdir(uploadConfig.directory, { recursive: true });
    const fileName = `${randomUUID()}${extension}`;
    await writeFile(path.join(uploadConfig.directory, fileName), data, { flag: 'wx' });
    const forwardedProto = request.headers['x-forwarded-proto'];
    const protocol = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : request.protocol;
    const host = request.headers.host;
    return reply.code(201).send({ url: `${protocol}://${host}/uploads/${fileName}` });
  });

  // --- Upload Video Trailer ---
  fastify.post('/uploads/trailers', {
    preHandler: auth.authorize('ADMIN'),
    schema: {
      tags: ['Uploads'],
      operationId: 'uploadTrailer',
      summary: 'Upload a movie trailer video file',
      description: 'ADMIN only. Accepts exactly one non-empty MP4, WEBM, OGG, or MOV file up to 50MB and uploads it to MinIO (or stores locally if MinIO is not configured).',
      security: bearerSecurity,
      consumes: ['multipart/form-data'],
      response: {
        201: {
          description: 'The video was stored and is available from the returned URL.',
          type: 'object',
          additionalProperties: false,
          required: ['url'],
          properties: {
            url: { type: 'string', format: 'uri', example: 'https://minio-s3.hoctuthien.com/test/trailers/2fc10a6f-ef1f-40d9-a783-13e69c9055b0.mp4' },
          },
        },
        ...errorResponses(400, 401, 403),
      },
    },
  }, async (request, reply) => {
    const part = await request.file();
    if (!part) throw new ValidationError('Video file is required');
    const extension = VIDEO_EXTENSIONS[part.mimetype];
    if (!extension) throw new ValidationError('Only MP4, WEBM, OGG or MOV video formats are allowed');

    const maxVideoBytes = 52428800; // 50MB limit for video trailers
    let data;
    try {
      data = await part.toBuffer();
    } catch (error) {
      if (error?.code === 'FST_REQ_FILE_TOO_LARGE') throw new ValidationError('Video exceeds the upload size limit');
      throw error;
    }
    if (data.length === 0) throw new ValidationError('Video file is empty');
    if (data.length > maxVideoBytes) throw new ValidationError('Video exceeds the upload size limit');

    const fileName = `${randomUUID()}${extension}`;
    const hasMinio = minioConfig && minioConfig.endpoint && minioConfig.accessKey && minioConfig.secretKey;

    if (hasMinio) {
      // 1. Upload to MinIO
      const endpointClean = minioConfig.endpoint.replace(/^https?:\/\//, '');
      const useSSL = minioConfig.endpoint.startsWith('https');
      
      const minioClient = new MinioClient({
        endPoint: endpointClean,
        useSSL: useSSL,
        accessKey: minioConfig.accessKey,
        secretKey: minioConfig.secretKey,
      });

      const objectName = `trailers/${fileName}`;
      try {
        await minioClient.putObject(
          minioConfig.bucketName,
          objectName,
          data,
          data.length,
          { 'content-type': part.mimetype }
        );
        const protocol = useSSL ? 'https' : 'http';
        return reply.code(201).send({ url: `${protocol}://${endpointClean}/${minioConfig.bucketName}/${objectName}` });
      } catch (err) {
        throw new ValidationError(`MinIO upload error: ${err.message}`);
      }
    } else {
      // 2. Fallback to Local Storage
      await mkdir(uploadConfig.directory, { recursive: true });
      await writeFile(path.join(uploadConfig.directory, fileName), data, { flag: 'wx' });
      
      const forwardedProto = request.headers['x-forwarded-proto'];
      const protocol = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : request.protocol;
      const host = request.headers.host;
      return reply.code(201).send({ url: `${protocol}://${host}/uploads/${fileName}` });
    }
  });
}

