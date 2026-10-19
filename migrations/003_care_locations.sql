CREATE TABLE care_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dentist_id uuid NOT NULL REFERENCES dentists (id),
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dentist_id, id),
  CHECK (btrim(name) <> ''),
  CHECK (active OR NOT is_default)
);

CREATE UNIQUE INDEX care_locations_one_default_idx
  ON care_locations (dentist_id)
  WHERE active AND is_default;

CREATE TRIGGER care_locations_updated_at BEFORE UPDATE ON care_locations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE patient_locations (
  dentist_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  location_id uuid NOT NULL,
  PRIMARY KEY (patient_id, location_id),
  FOREIGN KEY (dentist_id, patient_id) REFERENCES patients (dentist_id, id) ON DELETE CASCADE,
  FOREIGN KEY (dentist_id, location_id) REFERENCES care_locations (dentist_id, id)
);

CREATE INDEX patient_locations_location_idx ON patient_locations (location_id, patient_id);

ALTER TABLE care_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_locations FORCE ROW LEVEL SECURITY;
ALTER TABLE patient_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_locations FORCE ROW LEVEL SECURITY;

CREATE POLICY care_locations_isolation ON care_locations
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

CREATE POLICY patient_locations_isolation ON patient_locations
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON care_locations, patient_locations TO implante_app;
