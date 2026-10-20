import { describe, expect, it } from 'vitest';
import { splitName } from '../nameSplit.js';

describe('splitName', () => {
  it('splits a standard two-token name', () => {
    expect(splitName('Priya Sharma')).toEqual({
      firstName: 'Priya',
      lastName: 'Sharma',
    });
  });

  it('strips the "Dr." honorific', () => {
    expect(splitName('Dr. Trupti Patil')).toEqual({
      firstName: 'Trupti',
      lastName: 'Patil',
    });
  });

  it('strips Mr./Mrs./Ms./Prof honorifics', () => {
    expect(splitName('Mr. Rajesh Kumar').firstName).toBe('Rajesh');
    expect(splitName('Mrs Anita Verma').firstName).toBe('Anita');
    expect(splitName('Ms. Kavita Rao').firstName).toBe('Kavita');
    expect(splitName('Prof Vinay Mehta').firstName).toBe('Vinay');
  });

  it('uses first + last for multi-word names', () => {
    expect(splitName('Nandini Krishna Ramanujan')).toEqual({
      firstName: 'Nandini',
      lastName: 'Ramanujan',
    });
  });

  it('returns lastName=null for single-token names', () => {
    expect(splitName('Rajesh')).toEqual({
      firstName: 'Rajesh',
      lastName: null,
    });
  });

  it('returns both null for empty input', () => {
    expect(splitName('')).toEqual({ firstName: null, lastName: null });
    expect(splitName('   ')).toEqual({ firstName: null, lastName: null });
  });

  it('handles honorific-only input', () => {
    expect(splitName('Dr.')).toEqual({ firstName: null, lastName: null });
  });

  it('preserves hyphenated last names', () => {
    expect(splitName('Priya Sharma-Rao')).toEqual({
      firstName: 'Priya',
      lastName: 'Sharma-Rao',
    });
  });

  it('normalises excess whitespace', () => {
    expect(splitName('  Priya    Sharma  ')).toEqual({
      firstName: 'Priya',
      lastName: 'Sharma',
    });
  });
});
