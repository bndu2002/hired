import { describe, expect, it } from 'vitest';
import {
  extractVariableNames,
  render,
  UnresolvedTemplateVarsError,
} from '../templating.js';

describe('render — basic substitution', () => {
  it('replaces a single variable', () => {
    expect(render('Hi {{name}}', { name: 'Rahul' })).toBe('Hi Rahul');
  });

  it('replaces multiple variables', () => {
    expect(
      render('Hi {{name}}, saw your {{role}} at {{company}}.', {
        name: 'Priya',
        role: 'Staff Engineer',
        company: 'Acme',
      }),
    ).toBe('Hi Priya, saw your Staff Engineer at Acme.');
  });

  it('replaces the same variable multiple times', () => {
    expect(
      render('{{name}} — I noticed {{name}}, so I thought I would reach out.', {
        name: 'Alex',
      }),
    ).toBe('Alex — I noticed Alex, so I thought I would reach out.');
  });

  it('tolerates whitespace inside braces', () => {
    expect(render('Hi {{ name }} and {{   role   }}', { name: 'A', role: 'B' })).toBe(
      'Hi A and B',
    );
  });

  it('leaves text with no variables unchanged', () => {
    expect(render('Plain text, no vars.', {})).toBe('Plain text, no vars.');
  });

  it('returns the empty string for empty input', () => {
    expect(render('', {})).toBe('');
  });

  it('allows empty-string values (explicit, not unresolved)', () => {
    expect(render('[{{middle}}]', { middle: '' })).toBe('[]');
  });
});

describe('render — regex metachar safety', () => {
  // Classic replace() footgun: using a replacement STRING (not callback)
  // interprets `$&`, `$1`, `$'` etc. We use a callback — these must pass
  // through literally.
  it('values containing $ metachars are inserted literally', () => {
    expect(render('Price: {{tag}}', { tag: '$100 for $5' })).toBe(
      'Price: $100 for $5',
    );
  });

  it('values containing $& are inserted literally', () => {
    expect(render('{{v}}', { v: 'before $& after' })).toBe('before $& after');
  });

  it('values containing $1 are inserted literally', () => {
    expect(render('{{v}}', { v: '$1 is literal' })).toBe('$1 is literal');
  });
});

describe('render — unresolved variables', () => {
  it('throws UnresolvedTemplateVarsError when a variable is missing', () => {
    expect(() => render('Hi {{name}}', {})).toThrow(UnresolvedTemplateVarsError);
  });

  it('error.missing lists every unresolved variable', () => {
    try {
      render('Hi {{name}}, saw your {{role}} at {{company}}.', {
        name: 'A',
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnresolvedTemplateVarsError);
      expect((err as UnresolvedTemplateVarsError).missing).toEqual([
        'role',
        'company',
      ]);
    }
  });

  it('error.missing deduplicates repeated variables', () => {
    try {
      render('{{missing}} and {{missing}} and {{missing}}', {});
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as UnresolvedTemplateVarsError).missing).toEqual(['missing']);
    }
  });

  it('error message is useful to a developer', () => {
    try {
      render('{{a}}{{b}}', {});
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('a, b');
    }
  });
});

describe('render — malformed templates (match patterns we deliberately do NOT support)', () => {
  it('leaves single-brace sequences alone (not treated as variables)', () => {
    expect(render('{name} and {{name}}', { name: 'X' })).toBe('{name} and X');
  });

  it('ignores empty brace blocks', () => {
    expect(render('a {{}} b', {})).toBe('a {{}} b');
  });

  it('ignores identifier-starting-with-digit', () => {
    // Not a valid variable name — left as literal text, no throw.
    expect(render('{{1foo}} bar', {})).toBe('{{1foo}} bar');
  });

  it('ignores identifiers containing hyphens or dots', () => {
    expect(render('{{job-title}} and {{job.title}}', {})).toBe(
      '{{job-title}} and {{job.title}}',
    );
  });
});

describe('render — realistic LinkedIn / Gmail cases', () => {
  it('renders a connect-request template', () => {
    const template =
      "Hi {{firstName}}, I'm applying for the {{jobTitle}} role at {{companyName}} " +
      'and would love to connect to learn more about the team.';
    const vars = {
      firstName: 'Rahul',
      jobTitle: 'Senior Full-Stack Developer',
      companyName: 'Acme',
    };
    expect(render(template, vars)).toBe(
      "Hi Rahul, I'm applying for the Senior Full-Stack Developer role at Acme " +
        'and would love to connect to learn more about the team.',
    );
  });

  it('renders a DM-after-accept template with multi-line body', () => {
    const template = `Hi {{firstName}},

Thanks for connecting. I'm applying for the {{jobTitle}} role at {{companyName}} — would you be open to a referral if my profile looks like a fit?

Best,
{{myName}}`;
    const vars = {
      firstName: 'Priya',
      jobTitle: 'Staff Engineer',
      companyName: 'Globex',
      myName: 'Vandana',
    };
    const out = render(template, vars);
    expect(out).toContain('Hi Priya,');
    expect(out).toContain('Staff Engineer');
    expect(out).toContain('Globex');
    expect(out).toContain('Best,\nVandana');
  });
});

describe('extractVariableNames', () => {
  it('returns names in order of first appearance', () => {
    expect(extractVariableNames('{{b}} {{a}} {{c}}')).toEqual(['b', 'a', 'c']);
  });

  it('deduplicates repeated names', () => {
    expect(extractVariableNames('{{x}} and {{x}} and {{y}} and {{x}}')).toEqual([
      'x',
      'y',
    ]);
  });

  it('returns [] for a template with no variables', () => {
    expect(extractVariableNames('nothing here')).toEqual([]);
  });

  it('ignores malformed variable patterns', () => {
    expect(extractVariableNames('{bad} {{1nope}} {{dotted.name}} {{ok}}')).toEqual([
      'ok',
    ]);
  });

  it('handles whitespace inside braces', () => {
    expect(extractVariableNames('{{ a }} {{   b }}')).toEqual(['a', 'b']);
  });
});
