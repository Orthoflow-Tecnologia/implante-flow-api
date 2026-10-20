CREATE TABLE installed_implants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dentist_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  fdi integer NOT NULL CHECK (
    fdi IN (
      18, 17, 16, 15, 14, 13, 12, 11,
      21, 22, 23, 24, 25, 26, 27, 28,
      48, 47, 46, 45, 44, 43, 42, 41,
      31, 32, 33, 34, 35, 36, 37, 38
    )
  ),
  origin text NOT NULL CHECK (origin IN ('preexisting', 'procedure_recorded')),
  source_procedure_id uuid,
  manufacturer text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  size text NOT NULL DEFAULT '',
  lot text NOT NULL DEFAULT '',
  installed_on date,
  origin_clinic text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dentist_id, id),
  FOREIGN KEY (dentist_id, patient_id) REFERENCES patients (dentist_id, id) ON DELETE CASCADE,
  FOREIGN KEY (dentist_id, source_procedure_id) REFERENCES procedures (dentist_id, id) ON DELETE SET NULL,
  CHECK (
    (origin = 'preexisting' AND source_procedure_id IS NULL)
    OR (origin = 'procedure_recorded')
  )
);

CREATE INDEX installed_implants_patient_idx
  ON installed_implants (dentist_id, patient_id, active, fdi);

CREATE UNIQUE INDEX installed_implants_source_site_idx
  ON installed_implants (dentist_id, source_procedure_id, fdi)
  WHERE origin = 'procedure_recorded' AND source_procedure_id IS NOT NULL AND active;

CREATE TRIGGER installed_implants_updated_at BEFORE UPDATE ON installed_implants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE procedure_implant_links (
  dentist_id uuid NOT NULL,
  procedure_id uuid NOT NULL,
  implant_id uuid NOT NULL,
  PRIMARY KEY (procedure_id, implant_id),
  FOREIGN KEY (dentist_id, procedure_id) REFERENCES procedures (dentist_id, id) ON DELETE CASCADE,
  FOREIGN KEY (dentist_id, implant_id) REFERENCES installed_implants (dentist_id, id)
);

CREATE INDEX procedure_implant_links_implant_idx
  ON procedure_implant_links (implant_id, procedure_id);

ALTER TABLE installed_implants ENABLE ROW LEVEL SECURITY;
ALTER TABLE installed_implants FORCE ROW LEVEL SECURITY;
ALTER TABLE procedure_implant_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedure_implant_links FORCE ROW LEVEL SECURITY;

CREATE POLICY installed_implants_isolation ON installed_implants
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

CREATE POLICY procedure_implant_links_isolation ON procedure_implant_links
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON installed_implants, procedure_implant_links TO implante_app;
