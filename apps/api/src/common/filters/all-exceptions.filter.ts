import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

interface ErrorResponseBody {
  statusCode: number;
  path: string;
  timestamp: string;
  message: string;
}

/**
 * Catches everything, including errors NestJS didn't throw as an HttpException. In
 * production, an unrecognized error is never echoed to the client — only the generic
 * message below — while the real error (with stack trace) still goes to structured logs.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const isProduction = process.env.NODE_ENV === 'production';

    const message = isHttpException
      ? this.extractMessage(exception)
      : !isProduction && exception instanceof Error
        ? exception.message
        : 'Internal server error';

    if (!isHttpException || status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ err: exception, path: request.url }, 'Unhandled exception');
    }

    const body: ErrorResponseBody = {
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      message,
    };

    response.status(status).json(body);
  }

  private extractMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response !== null && 'message' in response) {
      const { message } = response as { message: string | string[] };
      return Array.isArray(message) ? message.join(', ') : message;
    }
    return exception.message;
  }
}
