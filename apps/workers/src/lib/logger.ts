import pino from 'pino';
import type { Env } from '../config/env';

export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>) {
  return pino({
    level: env.LOG_LEVEL,
    transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
    // Same redaction contract as the API — a worker that indexes wallets and RPC
    // responses must never leak a key, token, or seed phrase into logs either.
    redact: {
      paths: ['*.privateKey', '*.seedPhrase', '*.token', '*.secret'],
      censor: '[redacted]',
    },
  });
}
