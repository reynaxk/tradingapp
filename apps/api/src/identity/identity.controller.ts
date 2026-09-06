import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AddressParamDto } from '../social/dto/address-param.dto';
import { CurrentUser } from './current-user.decorator';
import { WalletChallengeDto } from './dto/wallet-challenge.dto';
import { WalletVerifyDto } from './dto/wallet-verify.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { IdentityService, type SessionUser } from './identity.service';
import { WalletService } from './wallet.service';

@Controller('identity')
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly wallets: WalletService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(201)
  @Post('session')
  createSession() {
    return this.identity.createAnonymousSession();
  }

  // Challenge issuance is the one wallet-ownership endpoint worth throttling tighter than
  // the mutation default below — see docs/TRADING.md#security (a rate-limited nonce mint
  // is cheap insurance against someone spamming challenges for an address they don't own).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  @Post('wallet/challenge')
  createWalletChallenge(@Body() body: WalletChallengeDto, @CurrentUser() user: SessionUser) {
    return this.wallets.createChallenge(user.id, body.address);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('wallet/verify')
  verifyWalletChallenge(@Body() body: WalletVerifyDto, @CurrentUser() user: SessionUser) {
    return this.wallets.verifyChallenge(user.id, body.nonce, body.signature);
  }

  @UseGuards(JwtAuthGuard)
  @Get('wallets')
  listWallets(@CurrentUser() user: SessionUser) {
    return this.wallets.listWallets(user.id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Delete('wallets/:address')
  unlinkWallet(@Param() params: AddressParamDto, @CurrentUser() user: SessionUser) {
    return this.wallets.unlinkWallet(user.id, params.address);
  }
}
