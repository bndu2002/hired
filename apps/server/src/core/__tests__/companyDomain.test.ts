import { describe, expect, it } from 'vitest';
import { companyNameToDomain } from '../companyDomain.js';

describe('companyNameToDomain', () => {
  it('handles a simple single-word company', () => {
    expect(companyNameToDomain('Appscrip')).toBe('appscrip.com');
    expect(companyNameToDomain('Flexiple')).toBe('flexiple.com');
  });

  it('strips "Pvt Ltd" suffix', () => {
    expect(companyNameToDomain('Softobiz Technologies Pvt Ltd')).toBe(
      'softobiztechnologies.com',
    );
  });

  it('strips "Private Limited" suffix', () => {
    expect(companyNameToDomain('Acme Private Limited')).toBe('acme.com');
  });

  it('strips "Inc" / "LLC" suffixes', () => {
    expect(companyNameToDomain('Stripe Inc')).toBe('stripe.com');
    expect(companyNameToDomain('Acme LLC')).toBe('acme.com');
  });

  it('strips periods in "Inc."', () => {
    expect(companyNameToDomain('Stripe Inc.')).toBe('stripe.com');
  });

  it('removes punctuation and spaces entirely', () => {
    expect(companyNameToDomain("Heads Up For Tails")).toBe('headsupfortails.com');
    expect(companyNameToDomain('AT&T')).toBe('att.com');
    expect(companyNameToDomain("McDonald's")).toBe('mcdonalds.com');
  });

  it('lowercases the whole thing', () => {
    expect(companyNameToDomain('DELOITTE USI')).toBe('deloitteusi.com');
  });

  it('preserves alphanumerics (numbers in company name)', () => {
    expect(companyNameToDomain('37signals')).toBe('37signals.com');
  });

  it('throws if no valid characters remain', () => {
    expect(() => companyNameToDomain('')).toThrow(/cannot derive/);
    expect(() => companyNameToDomain('!!!')).toThrow(/cannot derive/);
  });

  it('prefers the longest matching suffix', () => {
    // "Pvt Ltd" matches as a whole, not just "Ltd"
    expect(companyNameToDomain('Acme Pvt Ltd')).toBe('acme.com');
  });
});
