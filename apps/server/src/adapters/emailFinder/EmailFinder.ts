/**
 * Re-exports the EmailFinder interface from shared-types.
 * See `.kiro/specs/hired/design.md § 7` for the pluggable boundary (D4).
 */

export type {
  EmailFindInput,
  EmailFindResult,
  EmailFinder,
} from '@hired/types';
