import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalAuthGuard } from './guards/optional-auth.guard';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { WalletService } from './wallet.service';

/**
 * Owns users and session auth — see docs/SOCIAL.md#authentication and
 * docs/WALLET_SECURITY.md for the login model this deliberately does not yet implement.
 * Exports IdentityService and both guards so SocialModule (and anything else that needs
 * "who is calling") can depend on this module without reaching into its internals.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { expiresIn: '90d' },
      }),
    }),
  ],
  controllers: [IdentityController],
  providers: [IdentityService, WalletService, JwtAuthGuard, OptionalAuthGuard],
  exports: [IdentityService, WalletService, JwtAuthGuard, OptionalAuthGuard],
})
export class IdentityModule {}
