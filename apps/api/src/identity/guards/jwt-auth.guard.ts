import { Injectable, type CanActivate, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { resolveSessionUser, type AuthenticatedRequest } from '../auth.util';
import { IdentityService } from '../identity.service';

/**
 * Requires a valid session — for mutations that change a specific user's own state
 * (follow, unfollow, like). See docs/SOCIAL.md#authentication. Public reads never use this.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly identity: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await resolveSessionUser(req, this.identity);
    if (!user) throw new UnauthorizedException('A valid session is required for this action');
    req.user = user;
    return true;
  }
}
