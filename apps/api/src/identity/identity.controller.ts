import { Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IdentityService } from './identity.service';

@Controller('identity')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  /**
   * Issues a new anonymous session. No wallet or identity claim is requested or trusted —
   * see docs/SOCIAL.md#authentication. Tightly throttled per IP: this is the one endpoint
   * that creates a database row on every call with no other rate limit backing it.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(201)
  @Post('session')
  createSession() {
    return this.identity.createAnonymousSession();
  }
}
