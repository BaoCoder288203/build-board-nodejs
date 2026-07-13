export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly errors?: unknown;

  constructor(
    message: string,
    statusCode = 400,
    code = "BAD_REQUEST",
    errors?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
  }
}
