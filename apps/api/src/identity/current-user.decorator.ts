import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.util';

/** Reads the session user a guard already attached — `null` under `OptionalAuthGuard` when
 *  the caller is unauthenticated, always present under `JwtAuthGuard`. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
  return req.user ?? null;
});
