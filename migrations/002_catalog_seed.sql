INSERT INTO implant_manufacturers (id, name) VALUES
  ('neodent', 'Neodent'),
  ('straumann', 'Straumann'),
  ('nobel-biocare', 'Nobel Biocare');

INSERT INTO implant_models (id, manufacturer_id, name) VALUES
  ('neodent-drive-gm', 'neodent', 'Drive GM'),
  ('neodent-helix-gm', 'neodent', 'Helix GM'),
  ('neodent-grand-morse', 'neodent', 'Grand Morse'),
  ('straumann-blx', 'straumann', 'BLX'),
  ('straumann-blt', 'straumann', 'BLT'),
  ('straumann-tlx', 'straumann', 'TLX'),
  ('nobel-active', 'nobel-biocare', 'NobelActive'),
  ('nobel-parallel', 'nobel-biocare', 'NobelParallel');

INSERT INTO implant_sizes (id, label) VALUES
  ('3.3x8', '3.3 × 8 mm'),
  ('3.3x10', '3.3 × 10 mm'),
  ('3.3x11.5', '3.3 × 11.5 mm'),
  ('3.3x13', '3.3 × 13 mm'),
  ('3.5x8', '3.5 × 8 mm'),
  ('3.5x10', '3.5 × 10 mm'),
  ('3.5x11.5', '3.5 × 11.5 mm'),
  ('3.5x13', '3.5 × 13 mm'),
  ('3.75x8', '3.75 × 8 mm'),
  ('3.75x10', '3.75 × 10 mm'),
  ('3.75x11.5', '3.75 × 11.5 mm'),
  ('3.75x13', '3.75 × 13 mm'),
  ('4.0x8', '4.0 × 8 mm'),
  ('4.0x10', '4.0 × 10 mm'),
  ('4.0x11.5', '4.0 × 11.5 mm'),
  ('4.0x13', '4.0 × 13 mm'),
  ('4.3x10', '4.3 × 10 mm'),
  ('4.3x11.5', '4.3 × 11.5 mm'),
  ('4.3x13', '4.3 × 13 mm'),
  ('4.3x16', '4.3 × 16 mm'),
  ('4.5x8', '4.5 × 8 mm'),
  ('4.5x10', '4.5 × 10 mm'),
  ('4.5x13', '4.5 × 13 mm'),
  ('5.0x8', '5.0 × 8 mm'),
  ('5.0x10', '5.0 × 10 mm'),
  ('5.0x11.5', '5.0 × 11.5 mm'),
  ('5.0x13', '5.0 × 13 mm');

INSERT INTO graft_manufacturers (id, name) VALUES
  ('geistlich', 'Geistlich'),
  ('straumann', 'Straumann'),
  ('baumer', 'Baumer');

INSERT INTO graft_models (id, manufacturer_id, name, product_type, presentations, granulometries) VALUES
  ('geistlich-bio-oss', 'geistlich', 'Bio-Oss', 'Osso bovino desproteinizado', ARRAY['po'], ARRAY['0,25–1 mm', '1–2 mm']),
  ('geistlich-bio-oss-collagen', 'geistlich', 'Bio-Oss Collagen', 'Osso bovino desproteinizado', ARRAY['bloco'], ARRAY[]::text[]),
  ('straumann-cerabone', 'straumann', 'cerabone', 'Osso bovino', ARRAY['po'], ARRAY['0,5–1 mm', '1–2 mm']),
  ('straumann-maxgraft', 'straumann', 'maxgraft', 'Aloenxerto', ARRAY['bloco', 'po'], ARRAY['0,5–2 mm']),
  ('baumer-ox-bone', 'baumer', 'Ox Bone', 'Osso bovino', ARRAY['bloco', 'po'], ARRAY['0,25–1 mm', '1–2 mm']);
