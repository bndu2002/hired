/**
 * Event repository — the append-only log (D3).
 *
 * The ONLY way to write to `events`. No UPDATE, no DELETE, ever. The source
 * of truth for every state transition in the system.
 *
 * See .kiro/specs/hired/design.md § 5-6.
 */

import type { AppEvent, EventRow, EventType } from '@hired/types';
import { pool } from '../client.js';

interface RawEventRow {
  id: number;
  contact_id: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

function rowToEvent(r: RawEventRow): EventRow {
  return {
    id: r.id,
    contactId: r.contact_id,
    eventType: r.event_type as EventType,
    payload: r.payload,
    createdAt: r.created_at.toISOString(),
  };
}

/** Append a typed event for a contact. Returns the persisted row. */
export async function append(
  contactId: number,
  event: AppEvent,
): Promise<EventRow> {
  const result = await pool.query<RawEventRow>(
    `
    INSERT INTO events (contact_id, event_type, payload)
    VALUES ($1, $2, $3::jsonb)
    RETURNING *
    `,
    [contactId, event.type, JSON.stringify(event.payload)],
  );
  const row = result.rows[0];
  if (!row) throw new Error('append event: no row returned');
  return rowToEvent(row);
}

/** Read all events for a contact in chronological order. */
export async function listByContact(contactId: number): Promise<EventRow[]> {
  const result = await pool.query<RawEventRow>(
    `
    SELECT * FROM events
    WHERE contact_id = $1
    ORDER BY created_at, id
    `,
    [contactId],
  );
  return result.rows.map(rowToEvent);
}
