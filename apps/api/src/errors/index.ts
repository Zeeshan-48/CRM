export interface SerializedErrorOutput {
  message: string;
  field?: string;
}

export abstract class CustomError extends Error {
  abstract statusCode: number;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, CustomError.prototype);
  }

  serializeErrors(): SerializedErrorOutput {
    return { message: this.message };
  }
}

export class BadRequestError extends CustomError {
  statusCode = 400;
  constructor(message = "Bad Request") {
    super(message);
    Object.setPrototypeOf(this, BadRequestError.prototype);
  }
}

export class UnauthorizedError extends CustomError {
  statusCode = 401;
  constructor(message = "Unauthorized") {
    super(message);
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export class ForbiddenError extends CustomError {
  statusCode = 403;
  constructor(message = "Forbidden") {
    super(message);
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

export class NotFoundError extends CustomError {
  statusCode = 404;
  constructor(message = "Not Found") {
    super(message);
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ConflictError extends CustomError {
  statusCode = 409;
  constructor(message = "Conflict") {
    super(message);
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export class UnprocessableError extends CustomError {
  statusCode = 422;
  constructor(message = "Unprocessable Entity") {
    super(message);
    Object.setPrototypeOf(this, UnprocessableError.prototype);
  }
}

export class TooManyRequestError extends CustomError {
  statusCode = 429;
  constructor(message = "Too Many Requests") {
    super(message);
    Object.setPrototypeOf(this, TooManyRequestError.prototype);
  }
}

export class InternalServerError extends CustomError {
  statusCode = 500;
  constructor(message = "Internal Server Error") {
    super(message);
    Object.setPrototypeOf(this, InternalServerError.prototype);
  }
}
