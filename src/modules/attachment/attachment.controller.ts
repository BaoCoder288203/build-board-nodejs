import type { NextFunction, Request, Response } from "express";
import { createReadStream } from "node:fs";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import { requireUploadedFile } from "../../middleware/upload.js";
import * as attachmentService from "./attachment.service.js";
import {
  listAttachmentsQuerySchema,
  uploadAttachmentFieldsSchema,
} from "./attachment.schema.js";

export async function upload(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const fields = parseOrThrow(uploadAttachmentFieldsSchema, req.body ?? {});
    const file = requireUploadedFile(req.file);
    const result = await attachmentService.uploadAttachment(
      req.user.id,
      fields,
      file,
    );
    return successResponse(res, result, "Attachment uploaded", 201);
  } catch (error) {
    next(error);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(listAttachmentsQuerySchema, req.query);
    const result = await attachmentService.listAttachments(req.user.id, query);
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await attachmentService.getAttachment(
      req.user.id,
      param(req, "attachmentId"),
    );
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await attachmentService.deleteAttachment(
      req.user.id,
      param(req, "attachmentId"),
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function download(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await attachmentService.resolveDownload(
      req.user.id,
      param(req, "attachmentId"),
    );
    if (result.mode === "redirect") {
      return res.redirect(result.url);
    }
    res.setHeader("Content-Type", result.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(result.downloadName)}"`,
    );
    createReadStream(result.path).pipe(res);
  } catch (error) {
    next(error);
  }
}

export async function preview(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await attachmentService.resolveDownload(
      req.user.id,
      param(req, "attachmentId"),
    );
    if (result.mode === "redirect") {
      return res.redirect(result.url);
    }
    res.setHeader("Content-Type", result.mimeType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(result.downloadName)}"`,
    );
    createReadStream(result.path).pipe(res);
  } catch (error) {
    next(error);
  }
}
