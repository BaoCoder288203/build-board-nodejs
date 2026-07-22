import { z } from "zod";

const uuid = (label: string) =>
  z.string({ error: `${label} is required` }).uuid(`${label} must be a valid UUID`);

export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const taskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE"]);

export const createTaskSchema = z.object({
  columnId: uuid("Column id"),
  title: z
    .string({ error: "Title is required" })
    .trim()
    .min(3, "Title must be at least 3 characters")
    .max(255, "Title must be at most 255 characters"),
  description: z.string().trim().max(10000).optional().nullable(),
  priority: taskPrioritySchema.optional(),
  status: taskStatusSchema.optional(),
  dueDate: z.coerce.date().optional().nullable(),
  assigneeUserIds: z.array(z.string().uuid()).optional(),
  labelIds: z.array(z.string().uuid()).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(3).max(255).optional(),
  description: z.string().trim().max(10000).optional().nullable(),
  priority: taskPrioritySchema.optional(),
  status: taskStatusSchema.optional(),
  dueDate: z.coerce.date().optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
});

export const listTasksQuerySchema = z.object({
  boardId: z.string().uuid().optional(),
  columnId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  priority: taskPrioritySchema.optional(),
  status: taskStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).refine((q) => q.boardId || q.columnId || q.projectId, {
  message: "boardId, columnId, or projectId is required",
});

export const moveTaskSchema = z.object({
  destinationColumnId: uuid("Destination column id"),
  newPosition: z.number({ error: "newPosition is required" }).int().min(0),
  sourceColumnId: z.string().uuid().optional(),
});

export const assignTaskSchema = z.object({
  userId: uuid("User id"),
});

export const labelTaskSchema = z.object({
  labelId: uuid("Label id"),
});

export const createProjectLabelSchema = z.object({
  projectId: uuid("Project id"),
  name: z
    .string({ error: "Name is required" })
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters"),
  color: z
    .string({ error: "Color is required" })
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a hex value like #EF4444"),
  description: z.string().trim().max(500).optional().nullable(),
  /** When set, also attaches the new label to this task. */
  taskId: z.string().uuid().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type CreateProjectLabelInput = z.infer<typeof createProjectLabelSchema>;
