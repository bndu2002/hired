/**
 * Re-exports the EmailVerifier interface from shared-types.
 * See `.kiro/specs/hired/design.md § 7` for the pluggable boundary (D4).
 */

export type {
  EmailVerifier,
  VerifyResult,
  VerifyStatus,
} from '@hired/types';
