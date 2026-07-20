import multer from "multer";
import { AppError } from "../common/app-error.js";

/** Max video size; image/doc validated again in service. */
const MAX_BYTES = 100 * 1024 * 1024;

export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
}).single("file");

export function requireUploadedFile(
  file: Express.Multer.File | undefined,
): Express.Multer.File {
  if (!file) {
    throw new AppError("file is required", 400, "VALIDATION_ERROR");
  }
  return file;
}
