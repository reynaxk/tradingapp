import { Module } from '@nestjs/common';

/**
 * Empty on purpose. Owns users, wallets, and auth (email/passkey + SIWE) starting in
 * Phase 2 — see /docs/SOURCE_OF_TRUTH.md for the wallet-first data model this module will
 * implement. Registered now so the module boundary exists before the logic does.
 */
@Module({})
export class IdentityModule {}
