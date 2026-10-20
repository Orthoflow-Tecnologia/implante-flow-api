CREATE TABLE implant_references (
  id text PRIMARY KEY,
  manufacturer_id text NOT NULL REFERENCES implant_manufacturers (id),
  model_id text NOT NULL REFERENCES implant_models (id),
  reference text NOT NULL,
  size_id text NOT NULL REFERENCES implant_sizes (id),
  anvisa text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  UNIQUE (manufacturer_id, reference)
);

ALTER TABLE implant_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY implant_references_read ON implant_references FOR SELECT TO implante_app USING (active);
GRANT SELECT ON implant_references TO implante_app;

ALTER TABLE implant_pieces ADD COLUMN IF NOT EXISTS reference text NOT NULL DEFAULT '';

INSERT INTO implant_references (id, manufacturer_id, model_id, reference, size_id, anvisa) VALUES
  ('neodent-helix-gm-4.0x10', 'neodent', 'neodent-helix-gm', '114.224', '4.0x10', '80156920014'),
  ('neodent-helix-gm-3.75x10', 'neodent', 'neodent-helix-gm', '114.223', '3.75x10', '80156920014'),
  ('neodent-drive-gm-4.0x10', 'neodent', 'neodent-drive-gm', '110.618', '4.0x10', '80156920011'),
  ('straumann-blx-4.0x10', 'straumann', 'straumann-blx', '021.4301', '4.0x10', '10345590025'),
  ('straumann-blt-4.1x10', 'straumann', 'straumann-blt', '021.2310', '4.0x10', '10345590018'),
  ('nobel-active-4.3x10', 'nobel-biocare', 'nobel-active', '34130', '4.3x10', '80146540033'),
  ('nobel-parallel-4.3x10', 'nobel-biocare', 'nobel-parallel', '30130', '4.3x10', '80146540041');
