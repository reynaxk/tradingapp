import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { resolveSessionUser, type AuthenticatedRequest } from '../auth.util';
import { IdentityService } from '../identity.service';

/**
 * Attaches the caller's session user if a valid one is present, but never rejects the
 * request — for public reads that personalize slightly when authenticated (e.g.
 * `likedByMe`, `isFollowedByMe`) without requiring a session to view them. See
 * docs/SOCIAL.md#authentication.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly identity: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    req.user = await resolveSessionUser(req, this.identity);
    return true;
  }
}
