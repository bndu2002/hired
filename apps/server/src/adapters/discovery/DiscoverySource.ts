/**
 * Re-exports the DiscoverySource interface from the shared-types package.
 *
 * Why re-export instead of importing @hired/types directly in adapters:
 *   - Keeps all adapter imports consistent (`import { DiscoverySource } from './DiscoverySource.js'`)
 *   - If the interface ever needs server-side-only augmentation, this is
 *     the hook point
 *
 * See `.kiro/specs/hired/design.md § 7`.
 */

export type {
  CandidateContact,
  DiscoveryInput,
  DiscoverySource,
} from '@hired/types';
