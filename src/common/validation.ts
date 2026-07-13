import { ZodError, type ZodType } from "zod";
import { AppError } from "./app-error.js";

/** Field path → human-readable messages. Used by API clients and toasts. */
export type FieldErrors = Record<string, string[]>;

export type FormattedValidationError = {
  message: string;
  errors: FieldErrors;
};

/**
 * Turn Zod issues into client-facing copy.
 * Use this for every request body/query/params parse — all modules, all phases.
 */
export function formatZodError(error: ZodError): FormattedValidationError {
  const fieldErrors: FieldErrors = {};

  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "_form";
    if (!fieldErrors[path]) {
      fieldErrors[path] = [];
    }
    if (!fieldErrors[path].includes(issue.message)) {
      fieldErrors[path].push(issue.message);
    }
  }

  const uniqueMessages = [
    ...new Set(error.issues.map((issue) => issue.message)),
  ];

  return {
    message: uniqueMessages.join(". ") || "Please check the highlighted fields.",
    errors: fieldErrors,
  };
}

/**
 * Parse with Zod and throw AppError with a readable `message` + `errors` map.
 * Controllers must use this (or safeParse + formatZodError) — never a bare
 * "Validation failed" string.
 */
export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const formatted = formatZodError(result.error);
    throw new AppError(
      formatted.message,
      400,
      "VALIDATION_ERROR",
      formatted.errors,
    );
  }
  return result.data;
}

/** Normalize unknown validation payloads (ZodError instance or field map). */
export function normalizeValidationErrors(errors: unknown): {
  message?: string;
  errors: FieldErrors | null;
} {
  if (errors instanceof ZodError) {
    return formatZodError(errors);
  }

  if (errors && typeof errors === "object" && !Array.isArray(errors)) {
    const record = errors as Record<string, unknown>;

    // Zod flatten() shape
    if ("fieldErrors" in record || "formErrors" in record) {
      const fieldErrors: FieldErrors = {};
      const rawFields = (record.fieldErrors ?? {}) as Record<
        string,
        string[] | undefined
      >;
      for (const [key, value] of Object.entries(rawFields)) {
        if (value?.length) fieldErrors[key] = value;
      }
      const formErrors = (record.formErrors ?? []) as string[];
      if (formErrors.length) fieldErrors._form = formErrors;
      const message = Object.values(fieldErrors).flat().join(". ");
      return { message: message || undefined, errors: fieldErrors };
    }

    // Already FieldErrors
    const fieldErrors: FieldErrors = {};
    for (const [key, value] of Object.entries(record)) {
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        fieldErrors[key] = value as string[];
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return {
        message: Object.values(fieldErrors).flat().join(". "),
        errors: fieldErrors,
      };
    }
  }

  return { errors: null };
}
