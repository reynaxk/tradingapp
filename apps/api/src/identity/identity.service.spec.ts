import { JwtService } from '@nestjs/jwt';
import { prisma } from '@fomo/db';
import { IdentityService } from './identity.service';

jest.mock('@fomo/db', () => ({
  prisma: {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

describe('IdentityService', () => {
  const jwt = new JwtService({ secret: 'test-secret-at-least-16-chars' });
  const identity = new IdentityService(jwt);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a new anonymous user and returns a token naming it', async () => {
    (mockedPrisma.user.create as jest.Mock).mockResolvedValue({ id: 'user-1', walletAddress: null });

    const { token, userId } = await identity.createAnonymousSession();

    expect(userId).toBe('user-1');
    expect(mockedPrisma.user.create).toHaveBeenCalledWith({ data: {} });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // a real JWT, not a placeholder string
  });

  it('verifies a token it issued itself and confirms the user still exists', async () => {
    (mockedPrisma.user.create as jest.Mock).mockResolvedValue({ id: 'user-2' });
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-2' });

    const { token } = await identity.createAnonymousSession();
    const result = await identity.verifyToken(token);

    expect(result).toEqual({ id: 'user-2' });
    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-2' }, select: { id: true } });
  });

  it('rejects a token signed with a different secret', async () => {
    const otherJwt = new JwtService({ secret: 'a-completely-different-secret' });
    const forged = await otherJwt.signAsync({ sub: 'user-3' });

    const result = await identity.verifyToken(forged);

    expect(result).toBeNull();
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid token', async () => {
    const result = await identity.verifyToken('not-a-real-jwt');
    expect(result).toBeNull();
  });

  it('returns null when the token is valid but the user no longer exists', async () => {
    (mockedPrisma.user.create as jest.Mock).mockResolvedValue({ id: 'user-4' });
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const { token } = await identity.createAnonymousSession();
    const result = await identity.verifyToken(token);

    expect(result).toBeNull();
  });

  it('rejects an expired token', async () => {
    const shortLivedJwt = new JwtService({ secret: 'test-secret-at-least-16-chars', signOptions: { expiresIn: '0s' } });
    const expired = await shortLivedJwt.signAsync({ sub: 'user-5' });
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const result = await identity.verifyToken(expired);

    expect(result).toBeNull();
  });
});
