GRANT implante_app TO CURRENT_USER;

CREATE TABLE dentists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_user_id text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  cro text NOT NULL DEFAULT '',
  cro_uf text NOT NULL DEFAULT '',
  reminder_enabled boolean NOT NULL DEFAULT true,
  reminder_days_before integer NOT NULL DEFAULT 15 CHECK (reminder_days_before >= 1),
  email_channel boolean NOT NULL DEFAULT true,
  push_channel boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cro_uf = '' OR cro_uf ~ '^[A-Z]{2}$'),
  CHECK (phone = '' OR phone ~ '^[0-9]{10,11}$')
);

CREATE TABLE patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dentist_id uuid NOT NULL REFERENCES dentists (id),
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  cpf text NOT NULL DEFAULT '',
  birth_date date NOT NULL,
  notes text NOT NULL DEFAULT '',
  guardian text NOT NULL DEFAULT '',
  notify_by_email boolean NOT NULL DEFAULT false,
  notify_by_phone boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dentist_id, id),
  CHECK (btrim(name) <> ''),
  CHECK (phone = '' OR phone ~ '^[0-9]{10,11}$'),
  CHECK (cpf = '' OR cpf ~ '^[0-9]{11}$')
);

CREATE INDEX patients_dentist_name_idx ON patients (dentist_id, lower(name));

CREATE TABLE procedures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dentist_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  modality text NOT NULL CHECK (modality IN ('implante', 'enxerto', 'protese')),
  subtype text CHECK (subtype IN ('unitario', 'ponte', 'protocolo')),
  associated_graft boolean NOT NULL DEFAULT false,
  sinus_lift boolean NOT NULL DEFAULT false,
  sinus_lift_technique text CHECK (
    sinus_lift_technique IS NULL OR sinus_lift_technique IN ('janelaLateral', 'transalveolar', 'outro')
  ),
  sinus_lift_note text NOT NULL DEFAULT '',
  arch text CHECK (arch IS NULL OR arch IN ('superior', 'inferior')),
  surgery_date date NOT NULL,
  status_label text NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dentist_id, id),
  FOREIGN KEY (dentist_id, patient_id) REFERENCES patients (dentist_id, id),
  CHECK (
    (
      modality = 'enxerto'
      AND status_label IN ('planejado', 'realizado', 'maturacao', 'prontoParaImplante', 'intercorrencia')
    )
    OR (
      modality IN ('implante', 'protese')
      AND status_label IN (
        'planejado', 'instalado', 'osseointegracao', 'reabertura', 'protese', 'concluido', 'manutencao', 'intercorrencia'
      )
    )
  ),
  CHECK (modality <> 'enxerto' OR subtype IS NULL),
  CHECK (subtype IS DISTINCT FROM 'protocolo' OR arch IS NOT NULL),
  CHECK (NOT sinus_lift OR sinus_lift_technique IS NOT NULL),
  CHECK (sinus_lift_technique IS DISTINCT FROM 'outro' OR btrim(sinus_lift_note) <> '')
);

CREATE INDEX procedures_patient_idx ON procedures (dentist_id, patient_id, surgery_date DESC);

CREATE TABLE procedure_links (
  dentist_id uuid NOT NULL,
  procedure_id uuid NOT NULL,
  linked_procedure_id uuid NOT NULL,
  PRIMARY KEY (procedure_id, linked_procedure_id),
  FOREIGN KEY (dentist_id, procedure_id) REFERENCES procedures (dentist_id, id),
  FOREIGN KEY (dentist_id, linked_procedure_id) REFERENCES procedures (dentist_id, id),
  CHECK (procedure_id <> linked_procedure_id)
);

CREATE TABLE tooth_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dentist_id uuid NOT NULL,
  procedure_id uuid NOT NULL,
  fdi integer NOT NULL CHECK (
    fdi IN (
      18, 17, 16, 15, 14, 13, 12, 11,
      21, 22, 23, 24, 25, 26, 27, 28,
      48, 47, 46, 45, 44, 43, 42, 41,
      31, 32, 33, 34, 35, 36, 37, 38
    )
  ),
  role text NOT NULL CHECK (role IN ('pilar', 'pontico')),
  UNIQUE (dentist_id, id),
  UNIQUE (procedure_id, fdi),
  FOREIGN KEY (dentist_id, procedure_id) REFERENCES procedures (dentist_id, id) ON DELETE CASCADE
);

CREATE TABLE implant_pieces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dentist_id uuid NOT NULL,
  site_id uuid NOT NULL,
  manufacturer text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  size text NOT NULL DEFAULT '',
  lot text NOT NULL DEFAULT '',
  manufactured_on date,
  expires_on date,
  anvisa text NOT NULL DEFAULT '',
  UNIQUE (site_id),
  FOREIGN KEY (dentist_id, site_id) REFERENCES tooth_sites (dentist_id, id) ON DELETE CASCADE
);

CREATE TABLE graft_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dentist_id uuid NOT NULL,
  site_id uuid NOT NULL,
  origin text NOT NULL CHECK (origin IN ('biomaterial', 'autogeno')),
  processing text CHECK (processing IS NULL OR processing IN ('liofilizado')),
  presentation text CHECK (presentation IS NULL OR presentation IN ('bloco', 'po')),
  manufacturer text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  product_type text NOT NULL DEFAULT '',
  granulometry text NOT NULL DEFAULT '',
  size text NOT NULL DEFAULT '',
  lot text NOT NULL DEFAULT '',
  manufactured_on date,
  expires_on date,
  anvisa text NOT NULL DEFAULT '',
  donor_site text NOT NULL DEFAULT '',
  FOREIGN KEY (dentist_id, site_id) REFERENCES tooth_sites (dentist_id, id) ON DELETE CASCADE,
  CHECK (
    (origin = 'autogeno' AND processing IS NULL AND manufacturer = '' AND model = '' AND donor_site <> '')
    OR (origin = 'biomaterial' AND donor_site = '')
  ),
  CHECK (presentation IS DISTINCT FROM 'bloco' OR granulometry = ''),
  CHECK (presentation IS DISTINCT FROM 'po' OR granulometry <> '' OR manufacturer = '')
);

CREATE TABLE visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dentist_id uuid NOT NULL,
  procedure_id uuid NOT NULL,
  visited_on date NOT NULL,
  note text NOT NULL DEFAULT '',
  status_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dentist_id, id),
  FOREIGN KEY (dentist_id, procedure_id) REFERENCES procedures (dentist_id, id) ON DELETE CASCADE
);

CREATE INDEX visits_procedure_idx ON visits (dentist_id, procedure_id, visited_on DESC);

CREATE TABLE follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dentist_id uuid NOT NULL,
  procedure_id uuid NOT NULL,
  scheduled_on date NOT NULL,
  reason text NOT NULL CHECK (
    reason IN (
      'sutura', 'osseointegracao', 'instalarImplante', 'instalarPonte', 'instalarProtocolo', 'controle', 'reabertura'
    )
  ),
  status text NOT NULL CHECK (status IN ('agendado', 'realizado', 'faltou')),
  reminder_enabled boolean NOT NULL DEFAULT true,
  reminder_days_before integer NOT NULL DEFAULT 15 CHECK (reminder_days_before >= 1),
  overdue_notified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dentist_id, id),
  FOREIGN KEY (dentist_id, procedure_id) REFERENCES procedures (dentist_id, id) ON DELETE CASCADE
);

CREATE INDEX follow_ups_schedule_idx ON follow_ups (dentist_id, status, scheduled_on);

CREATE TABLE photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dentist_id uuid NOT NULL,
  procedure_id uuid NOT NULL,
  visit_id uuid,
  caption text NOT NULL DEFAULT '',
  object_key text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dentist_id, id),
  FOREIGN KEY (dentist_id, procedure_id) REFERENCES procedures (dentist_id, id) ON DELETE CASCADE,
  FOREIGN KEY (dentist_id, visit_id) REFERENCES visits (dentist_id, id)
);

CREATE TABLE certificate_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dentist_id uuid NOT NULL,
  procedure_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  object_key text NOT NULL,
  sha256 text NOT NULL,
  signed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (procedure_id, version),
  FOREIGN KEY (dentist_id, procedure_id) REFERENCES procedures (dentist_id, id)
);

CREATE INDEX certificate_versions_procedure_idx ON certificate_versions (dentist_id, procedure_id, version DESC);

CREATE TABLE implant_manufacturers (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE implant_models (
  id text PRIMARY KEY,
  manufacturer_id text NOT NULL REFERENCES implant_manufacturers (id),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (manufacturer_id, name)
);

CREATE TABLE implant_sizes (
  id text PRIMARY KEY,
  label text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE graft_manufacturers (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE graft_models (
  id text PRIMARY KEY,
  manufacturer_id text NOT NULL REFERENCES graft_manufacturers (id),
  name text NOT NULL,
  product_type text NOT NULL,
  presentations text[] NOT NULL,
  granulometries text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  UNIQUE (manufacturer_id, name)
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER dentists_updated_at BEFORE UPDATE ON dentists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER patients_updated_at BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER procedures_updated_at BEFORE UPDATE ON procedures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER follow_ups_updated_at BEFORE UPDATE ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION upsert_dentist(p_workos_user_id text, p_email text, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  result uuid;
BEGIN
  INSERT INTO dentists (workos_user_id, email, name)
  VALUES (p_workos_user_id, COALESCE(p_email, ''), COALESCE(p_name, ''))
  ON CONFLICT (workos_user_id) DO UPDATE
    SET email = CASE WHEN EXCLUDED.email <> '' THEN EXCLUDED.email ELSE dentists.email END,
        name = CASE WHEN dentists.name = '' THEN EXCLUDED.name ELSE dentists.name END,
        updated_at = now()
  RETURNING id INTO result;
  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION upsert_dentist(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_dentist(text, text, text) TO implante_app;

DO $rls$
DECLARE
  clinical text;
BEGIN
  FOREACH clinical IN ARRAY ARRAY[
    'dentists', 'patients', 'procedures', 'procedure_links', 'tooth_sites',
    'implant_pieces', 'graft_materials', 'visits', 'follow_ups', 'photos', 'certificate_versions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', clinical);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', clinical);
  END LOOP;
END
$rls$;

CREATE POLICY dentists_isolation ON dentists
  USING (id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

CREATE POLICY patients_isolation ON patients
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

CREATE POLICY procedures_isolation ON procedures
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

CREATE POLICY procedure_links_isolation ON procedure_links
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

CREATE POLICY tooth_sites_isolation ON tooth_sites
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

CREATE POLICY implant_pieces_isolation ON implant_pieces
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

CREATE POLICY graft_materials_isolation ON graft_materials
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

CREATE POLICY visits_isolation ON visits
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

CREATE POLICY follow_ups_isolation ON follow_ups
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

CREATE POLICY photos_isolation ON photos
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

CREATE POLICY certificate_versions_isolation ON certificate_versions
  USING (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid)
  WITH CHECK (dentist_id = NULLIF(current_setting('app.dentist_id', true), '')::uuid);

ALTER TABLE implant_manufacturers ENABLE ROW LEVEL SECURITY;
ALTER TABLE implant_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE implant_sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE graft_manufacturers ENABLE ROW LEVEL SECURITY;
ALTER TABLE graft_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY implant_manufacturers_read ON implant_manufacturers FOR SELECT TO implante_app USING (active);
CREATE POLICY implant_models_read ON implant_models FOR SELECT TO implante_app USING (active);
CREATE POLICY implant_sizes_read ON implant_sizes FOR SELECT TO implante_app USING (active);
CREATE POLICY graft_manufacturers_read ON graft_manufacturers FOR SELECT TO implante_app USING (active);
CREATE POLICY graft_models_read ON graft_models FOR SELECT TO implante_app USING (active);

GRANT USAGE ON SCHEMA public TO implante_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  dentists, patients, procedures, procedure_links, tooth_sites, implant_pieces,
  graft_materials, visits, follow_ups, photos, certificate_versions
TO implante_app;
GRANT SELECT ON implant_manufacturers, implant_models, implant_sizes, graft_manufacturers, graft_models
TO implante_app;
