import type { Request } from 'express';
import type { IdentityService, SessionUser } from './identity.service';

export type AuthenticatedRequest = Request & { user?: SessionUser | null };

/** Shared by both guards — resolves `Authorization: Bearer <token>` to a session user, or
 *  `null` for anything missing/malformed/invalid. Never throws. */
export async function resolveSessionUser(
  req: Request,
  identity: IdentityService,
): Promise<SessionUser | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;
  return identity.verifyToken(token);
}
