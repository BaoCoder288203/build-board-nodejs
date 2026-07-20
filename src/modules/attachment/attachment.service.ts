import {
  ActivityAction,
  ActivityEntityType,
  AttachmentFileType,
  type Prisma,
} from "@prisma/client";
import {
  assertPermission,
  getAccessibleProject,
} from "../../common/access.js";
import { AppError } from "../../common/app-error.js";
import {
  absoluteLocalPath,
  destroyUploaded,
  uploadBuffer,
} from "../../common/storage.js";
import { prisma } from "../../database/prisma.js";
import type { UploadAttachmentFields } from "./attachment.schema.js";

function publicAttachment(row: {
  id: string;
  workspaceId: string;
  taskId: string | null;
  commentId: string | null;
  uploadedBy: string;
  fileName: string;
  originalName: string;
  extension: string;
  mimeType: string;
  fileType: AttachmentFileType;
  size: bigint;
  width: number | null;
  height: number | null;
  duration: number | null;
  storageProvider: Prisma.AttachmentGetPayload<object>["storageProvider"];
  publicId: string;
  fileUrl: string;
  thumbnailUrl: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  uploader?: {
    id: string;
    fullName: string;
    email: string;
    avatarUrl: string | null;
  };
}) {
  return {
    id: row.id,
    attachmentId: row.id,
    workspaceId: row.workspaceId,
    taskId: row.taskId,
    commentId: row.commentId,
    uploadedBy: row.uploadedBy,
    fileName: row.fileName,
    originalName: row.originalName,
    extension: row.extension,
    mimeType: row.mimeType,
    fileType: row.fileType,
    size: Number(row.size),
    width: row.width,
    height: row.height,
    duration: row.duration,
    storageProvider: row.storageProvider,
    publicId: row.publicId,
    url: row.fileUrl,
    fileUrl: row.fileUrl,
    thumbnailUrl: row.thumbnailUrl,
    createdAt: row.createdAt,
    uploader: row.uploader
      ? {
          id: row.uploader.id,
          fullName: row.uploader.fullName,
          email: row.uploader.email,
          avatar: row.uploader.avatarUrl,
        }
      : undefined,
  };
}

async function assertTaskAccess(
  userId: string,
  projectId: string,
  permission?: string,
) {
  const access = await getAccessibleProject(userId, projectId);
  if (permission) {
    assertPermission(access.workspaceCtx, permission);
  }
  return access;
}

async function resolveTarget(fields: UploadAttachmentFields) {
  if (fields.taskId) {
    const task = await prisma.task.findFirst({
      where: { id: fields.taskId, deletedAt: null },
    });
    if (!task) throw new AppError("Task not found", 404, "TASK_NOT_FOUND");
    return {
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      taskId: task.id,
      commentId: null as string | null,
    };
  }

  const comment = await prisma.comment.findFirst({
    where: { id: fields.commentId, deletedAt: null },
    include: { task: true },
  });
  if (!comment || comment.task.deletedAt) {
    throw new AppError("Comment not found", 404, "COMMENT_NOT_FOUND");
  }
  return {
    workspaceId: comment.task.workspaceId,
    projectId: comment.task.projectId,
    taskId: comment.taskId,
    commentId: comment.id,
  };
}

async function ensureStorageQuota(workspaceId: string, addBytes: number) {
  let storage = await prisma.workspaceStorage.findUnique({
    where: { workspaceId },
  });
  if (!storage) {
    storage = await prisma.workspaceStorage.create({
      data: { workspaceId },
    });
  }
  if (storage.usedStorage + BigInt(addBytes) > storage.maxStorage) {
    throw new AppError(
      "Workspace storage quota exceeded",
      400,
      "STORAGE_QUOTA_EXCEEDED",
    );
  }
  return storage;
}

function storageDelta(fileType: AttachmentFileType, size: bigint) {
  if (fileType === AttachmentFileType.IMAGE) {
    return { imageSize: size, videoSize: 0n, documentSize: 0n };
  }
  if (fileType === AttachmentFileType.VIDEO) {
    return { imageSize: 0n, videoSize: size, documentSize: 0n };
  }
  return { imageSize: 0n, videoSize: 0n, documentSize: size };
}

export async function uploadAttachment(
  userId: string,
  fields: UploadAttachmentFields,
  file: Express.Multer.File,
) {
  const target = await resolveTarget(fields);
  await assertTaskAccess(userId, target.projectId, "task:update");
  await ensureStorageQuota(target.workspaceId, file.size);

  const uploaded = await uploadBuffer({
    buffer: file.buffer,
    originalName: file.originalname || "upload.bin",
    mimeType: file.mimetype,
  });

  const delta = storageDelta(uploaded.fileType, BigInt(uploaded.size));

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.attachment.create({
      data: {
        workspaceId: target.workspaceId,
        taskId: target.taskId,
        commentId: target.commentId,
        uploadedBy: userId,
        fileName: uploaded.fileName,
        originalName: uploaded.originalName,
        extension: uploaded.extension,
        mimeType: uploaded.mimeType,
        fileType: uploaded.fileType,
        size: BigInt(uploaded.size),
        storageProvider: uploaded.storageProvider,
        publicId: uploaded.publicId,
        fileUrl: uploaded.fileUrl,
        thumbnailUrl: uploaded.thumbnailUrl,
      },
      include: {
        uploader: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    await tx.workspaceStorage.update({
      where: { workspaceId: target.workspaceId },
      data: {
        usedStorage: { increment: BigInt(uploaded.size) },
        imageSize: { increment: delta.imageSize },
        videoSize: { increment: delta.videoSize },
        documentSize: { increment: delta.documentSize },
      },
    });

    await tx.activity.create({
      data: {
        workspaceId: target.workspaceId,
        projectId: target.projectId,
        actorId: userId,
        entityType: ActivityEntityType.ATTACHMENT,
        entityId: row.id,
        action: ActivityAction.UPLOAD,
        afterData: {
          taskId: target.taskId,
          commentId: target.commentId,
          originalName: uploaded.originalName,
          size: uploaded.size,
          fileType: uploaded.fileType,
        },
      },
    });

    return row;
  });

  return publicAttachment(created);
}

export async function listAttachments(
  userId: string,
  query: { taskId?: string; commentId?: string },
) {
  let projectId: string | undefined;
  const where: Prisma.AttachmentWhereInput = { deletedAt: null };

  if (query.taskId) {
    const task = await prisma.task.findFirst({
      where: { id: query.taskId, deletedAt: null },
    });
    if (!task) throw new AppError("Task not found", 404, "TASK_NOT_FOUND");
    projectId = task.projectId;
    where.taskId = task.id;
    where.commentId = null;
  } else if (query.commentId) {
    const comment = await prisma.comment.findFirst({
      where: { id: query.commentId, deletedAt: null },
      include: { task: true },
    });
    if (!comment || comment.task.deletedAt) {
      throw new AppError("Comment not found", 404, "COMMENT_NOT_FOUND");
    }
    projectId = comment.task.projectId;
    where.commentId = comment.id;
  } else {
    throw new AppError(
      "taskId or commentId is required",
      400,
      "VALIDATION_ERROR",
    );
  }

  await assertTaskAccess(userId, projectId);

  const rows = await prisma.attachment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      uploader: {
        select: {
          id: true,
          fullName: true,
          email: true,
          avatarUrl: true,
        },
      },
    },
  });

  return { items: rows.map(publicAttachment) };
}

export async function getAttachment(userId: string, attachmentId: string) {
  const row = await prisma.attachment.findFirst({
    where: { id: attachmentId, deletedAt: null },
    include: {
      task: true,
      comment: { include: { task: true } },
      uploader: {
        select: {
          id: true,
          fullName: true,
          email: true,
          avatarUrl: true,
        },
      },
    },
  });
  if (!row) {
    throw new AppError("Attachment not found", 404, "ATTACHMENT_NOT_FOUND");
  }

  const projectId =
    row.task?.projectId ?? row.comment?.task.projectId;
  if (!projectId) {
    throw new AppError("Attachment not found", 404, "ATTACHMENT_NOT_FOUND");
  }
  await assertTaskAccess(userId, projectId);
  return publicAttachment(row);
}

export async function deleteAttachment(userId: string, attachmentId: string) {
  const row = await prisma.attachment.findFirst({
    where: { id: attachmentId, deletedAt: null },
    include: {
      task: true,
      comment: { include: { task: true } },
    },
  });
  if (!row) {
    throw new AppError("Attachment not found", 404, "ATTACHMENT_NOT_FOUND");
  }

  const projectId =
    row.task?.projectId ?? row.comment?.task.projectId;
  if (!projectId) {
    throw new AppError("Attachment not found", 404, "ATTACHMENT_NOT_FOUND");
  }
  await assertTaskAccess(userId, projectId, "task:update");

  const size = row.size;
  const delta = storageDelta(row.fileType, size);

  await prisma.$transaction(async (tx) => {
    await tx.attachment.update({
      where: { id: attachmentId },
      data: { deletedAt: new Date() },
    });

    const storage = await tx.workspaceStorage.findUnique({
      where: { workspaceId: row.workspaceId },
    });
    if (storage) {
      const nextUsed =
        storage.usedStorage > size ? storage.usedStorage - size : 0n;
      const nextImage =
        storage.imageSize > delta.imageSize
          ? storage.imageSize - delta.imageSize
          : 0n;
      const nextVideo =
        storage.videoSize > delta.videoSize
          ? storage.videoSize - delta.videoSize
          : 0n;
      const nextDoc =
        storage.documentSize > delta.documentSize
          ? storage.documentSize - delta.documentSize
          : 0n;
      await tx.workspaceStorage.update({
        where: { workspaceId: row.workspaceId },
        data: {
          usedStorage: nextUsed,
          imageSize: nextImage,
          videoSize: nextVideo,
          documentSize: nextDoc,
        },
      });
    }

    await tx.activity.create({
      data: {
        workspaceId: row.workspaceId,
        projectId,
        actorId: userId,
        entityType: ActivityEntityType.ATTACHMENT,
        entityId: attachmentId,
        action: ActivityAction.DELETE,
        beforeData: {
          originalName: row.originalName,
          size: Number(row.size),
        },
      },
    });
  });

  await destroyUploaded({
    storageProvider: row.storageProvider,
    publicId: row.publicId,
    fileType: row.fileType,
  });

  return { message: "Attachment deleted" };
}

export async function resolveDownload(userId: string, attachmentId: string) {
  const attachment = await getAttachment(userId, attachmentId);
  const row = await prisma.attachment.findFirst({
    where: { id: attachmentId, deletedAt: null },
  });
  if (!row) {
    throw new AppError("Attachment not found", 404, "ATTACHMENT_NOT_FOUND");
  }

  if (row.storageProvider === "LOCAL") {
    return {
      mode: "local" as const,
      path: absoluteLocalPath(row.publicId),
      mimeType: row.mimeType,
      downloadName: row.originalName,
      attachment,
    };
  }

  return {
    mode: "redirect" as const,
    url: row.fileUrl,
    attachment,
  };
}
