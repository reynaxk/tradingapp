import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { prisma } from '@fomo/db';

interface SessionPayload {
  sub: string;
}

export interface SessionUser {
  id: string;
}

/**
 * Owns Phase 2's minimal session mechanism — see docs/SOCIAL.md#authentication for exactly
 * what it does and doesn't prove. It issues an anonymous session (a fresh User row, no
 * wallet-ownership claim made or trusted) so follows/likes are real and attributable
 * per-session without building the full email/passkey + SIWE login docs/WALLET_SECURITY.md
 * describes as Phase 2's eventual real login.
 */
@Injectable()
export class IdentityService {
  constructor(private readonly jwt: JwtService) {}

  async createAnonymousSession(): Promise<{ token: string; userId: string }> {
    const user = await prisma.user.create({ data: {} });
    const payload: SessionPayload = { sub: user.id };
    const token = await this.jwt.signAsync(payload);
    return { token, userId: user.id };
  }

  /**
   * Verifies a bearer token and confirms the user it names still exists. Never throws —
   * an invalid, expired, or stale token is simply "no user," same as no token at all. The
   * database round trip (rather than trusting the JWT's claim alone) is deliberate: a
   * token's `sub` is client-controlled in the sense that the client presents it, and the
   * server must confirm the entity it names is still real before honoring it — see
   * docs/SOCIAL.md#security.
   */
  async verifyToken(token: string): Promise<SessionUser | null> {
    let payload: SessionPayload;
    try {
      payload = await this.jwt.verifyAsync<SessionPayload>(token);
    } catch {
      return null;
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    return prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true } });
  }
}
