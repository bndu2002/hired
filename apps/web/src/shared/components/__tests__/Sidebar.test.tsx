import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar, NAV_ITEMS } from '../Sidebar.js';

/**
 * Phase 1.5 smoke test — proves the test harness (vitest + jsdom +
 * testing-library + jest-dom + react-router) is wired correctly. More
 * meaningful component tests arrive with the features themselves.
 */
describe('Sidebar', () => {
  it('renders the brand and every top-level nav item', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByText('Hired')).toBeInTheDocument();
    for (const item of NAV_ITEMS) {
      expect(
        screen.getByRole('link', { name: new RegExp(item.label, 'i') }),
      ).toHaveAttribute('href', item.path);
    }
  });
});
