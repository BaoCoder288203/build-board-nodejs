import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";
import { AttachmentFileType, StorageProvider } from "@prisma/client";
import { env } from "../config/env.js";
import { AppError } from "./app-error.js";

const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const VIDEO_MIME = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

const DOCUMENT_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
]);

const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 100 * 1024 * 1024;
const MAX_DOCUMENT = 10 * 1024 * 1024;

export type UploadedObject = {
  storageProvider: StorageProvider;
  publicId: string;
  fileUrl: string;
  thumbnailUrl: string | null;
  fileName: string;
  originalName: string;
  extension: string;
  mimeType: string;
  fileType: AttachmentFileType;
  size: number;
};

function hasCloudinary() {
  return Boolean(
    env.CLOUDINARY_URL ||
      (env.CLOUDINARY_CLOUD_NAME &&
        env.CLOUDINARY_API_KEY &&
        env.CLOUDINARY_API_SECRET),
  );
}

export function resolveStorageDriver(): "local" | "cloudinary" {
  if (env.STORAGE_DRIVER) return env.STORAGE_DRIVER;
  return hasCloudinary() ? "cloudinary" : "local";
}

export function detectFileType(mimeType: string): AttachmentFileType {
  if (IMAGE_MIME.has(mimeType)) return AttachmentFileType.IMAGE;
  if (VIDEO_MIME.has(mimeType)) return AttachmentFileType.VIDEO;
  if (DOCUMENT_MIME.has(mimeType)) return AttachmentFileType.DOCUMENT;
  throw new AppError(
    "Unsupported file type",
    400,
    "UNSUPPORTED_FILE_TYPE",
  );
}

export function assertFileSize(fileType: AttachmentFileType, size: number) {
  const max =
    fileType === AttachmentFileType.IMAGE
      ? MAX_IMAGE
      : fileType === AttachmentFileType.VIDEO
        ? MAX_VIDEO
        : MAX_DOCUMENT;
  if (size > max) {
    const label =
      fileType === AttachmentFileType.VIDEO
        ? "100MB"
        : "10MB";
    throw new AppError(
      `File exceeds the ${label} limit for ${fileType.toLowerCase()}s`,
      400,
      "FILE_TOO_LARGE",
    );
  }
}

function extensionFromName(name: string, mimeType: string) {
  const fromName = path.extname(name).replace(".", "").toLowerCase();
  if (fromName) return fromName.slice(0, 20);
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.includes("mp4")) return "mp4";
  return "bin";
}

function configureCloudinary() {
  if (env.CLOUDINARY_URL) {
    cloudinary.config({ secure: true });
    return;
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

async function uploadLocal(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  fileType: AttachmentFileType,
): Promise<UploadedObject> {
  const ext = extensionFromName(originalName, mimeType);
  const hash = createHash("sha1").update(buffer).digest("hex").slice(0, 10);
  const id = randomUUID();
  const fileName = `${id}-${hash}.${ext}`;
  const folder = path.resolve(process.cwd(), env.UPLOAD_DIR, "attachments");
  await mkdir(folder, { recursive: true });
  const abs = path.join(folder, fileName);
  await writeFile(abs, buffer);

  const publicId = `attachments/${fileName}`;
  const base = env.APP_URL.replace(/\/$/, "");
  const fileUrl = `${base}/uploads/${publicId}`;

  return {
    storageProvider: StorageProvider.LOCAL,
    publicId,
    fileUrl,
    thumbnailUrl: fileType === AttachmentFileType.IMAGE ? fileUrl : null,
    fileName,
    originalName,
    extension: ext,
    mimeType,
    fileType,
    size: buffer.length,
  };
}

async function uploadCloudinary(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  fileType: AttachmentFileType,
): Promise<UploadedObject> {
  configureCloudinary();
  const folder = env.CLOUDINARY_FOLDER?.trim() || "buildboard";
  const resourceType =
    fileType === AttachmentFileType.IMAGE
      ? "image"
      : fileType === AttachmentFileType.VIDEO
        ? "video"
        : "raw";

  const result = await new Promise<{
    public_id: string;
    secure_url: string;
    bytes: number;
    format?: string;
  }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `${folder}/attachments`,
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true,
      },
      (err, uploaded) => {
        if (err || !uploaded) {
          reject(err ?? new Error("Cloudinary upload failed"));
          return;
        }
        resolve({
          public_id: uploaded.public_id,
          secure_url: uploaded.secure_url,
          bytes: uploaded.bytes,
          format: uploaded.format,
        });
      },
    );
    stream.end(buffer);
  });

  const ext =
    result.format ||
    extensionFromName(originalName, mimeType);

  return {
    storageProvider: StorageProvider.CLOUDINARY,
    publicId: result.public_id,
    fileUrl: result.secure_url,
    thumbnailUrl:
      fileType === AttachmentFileType.IMAGE ? result.secure_url : null,
    fileName: path.basename(result.public_id),
    originalName,
    extension: ext.slice(0, 20),
    mimeType,
    fileType,
    size: result.bytes || buffer.length,
  };
}

export async function uploadBuffer(options: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}): Promise<UploadedObject> {
  const fileType = detectFileType(options.mimeType);
  assertFileSize(fileType, options.buffer.length);

  const driver = resolveStorageDriver();
  if (driver === "cloudinary") {
    if (!hasCloudinary()) {
      throw new AppError(
        "Cloudinary is not configured",
        500,
        "STORAGE_NOT_CONFIGURED",
      );
    }
    return uploadCloudinary(
      options.buffer,
      options.originalName,
      options.mimeType,
      fileType,
    );
  }

  return uploadLocal(
    options.buffer,
    options.originalName,
    options.mimeType,
    fileType,
  );
}

export async function destroyUploaded(options: {
  storageProvider: StorageProvider;
  publicId: string;
  fileType: AttachmentFileType;
}) {
  if (options.storageProvider === StorageProvider.LOCAL) {
    const abs = path.resolve(process.cwd(), env.UPLOAD_DIR, options.publicId);
    try {
      await unlink(abs);
    } catch {
      // ignore missing file
    }
    return;
  }

  if (!hasCloudinary()) return;
  configureCloudinary();
  const resourceType =
    options.fileType === AttachmentFileType.IMAGE
      ? "image"
      : options.fileType === AttachmentFileType.VIDEO
        ? "video"
        : "raw";
  try {
    await cloudinary.uploader.destroy(options.publicId, {
      resource_type: resourceType,
    });
  } catch {
    // ignore remote cleanup failures
  }
}

export function absoluteLocalPath(publicId: string) {
  return path.resolve(process.cwd(), env.UPLOAD_DIR, publicId);
}
