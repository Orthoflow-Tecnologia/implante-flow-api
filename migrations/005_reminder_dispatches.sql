CREATE TABLE reminder_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dentist_id uuid NOT NULL,
  follow_up_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('lead', 'overdue')),
  channel text NOT NULL CHECK (channel IN ('email', 'push')),
  scheduled_for date NOT NULL,
  status text NOT NULL CHECK (status IN ('aguardando', 'enviado', 'falha')),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follow_up_id, kind, channel),
  FOREIGN KEY (dentist_id, follow_up_id) REFERENCES follow_ups (dentist_id, id) ON DELETE CASCADE
);

ALTER TABLE reminder_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_dispatches FORCE ROW LEVEL SECURITY;

CREATE POLICY reminder_dispatches_isolation ON reminder_dispatches
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON reminder_dispatches TO implante_app;
