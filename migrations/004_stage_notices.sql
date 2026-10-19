CREATE TABLE stage_notice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dentist_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  procedure_id uuid NOT NULL,
  stage_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dentist_id, id),
  FOREIGN KEY (dentist_id, patient_id) REFERENCES patients (dentist_id, id),
  FOREIGN KEY (dentist_id, procedure_id) REFERENCES procedures (dentist_id, id)
);

CREATE TABLE stage_notice_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES stage_notice_events (id),
  dentist_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'phone')),
  status text NOT NULL CHECK (status IN ('aguardando', 'enviado', 'falha', 'revogada')),
  attempts integer NOT NULL DEFAULT 0,
  UNIQUE (event_id, channel)
);

CREATE INDEX stage_notice_deliveries_pending_idx
  ON stage_notice_deliveries (status, id)
  WHERE status = 'aguardando';

ALTER TABLE stage_notice_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_notice_events FORCE ROW LEVEL SECURITY;
ALTER TABLE stage_notice_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_notice_deliveries FORCE ROW LEVEL SECURITY;

CREATE POLICY stage_notice_events_isolation ON stage_notice_events
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

CREATE POLICY stage_notice_deliveries_isolation ON stage_notice_deliveries
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON stage_notice_events, stage_notice_deliveries TO implante_app;
