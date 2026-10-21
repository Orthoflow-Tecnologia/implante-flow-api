ALTER TABLE certificate_versions
  ADD COLUMN copies integer NOT NULL DEFAULT 1
    CHECK (copies IN (1, 2)),
  ADD COLUMN location_id uuid,
  ADD COLUMN location_name text NOT NULL DEFAULT '',
  ADD COLUMN location_address text NOT NULL DEFAULT '';

ALTER TABLE certificate_versions
  ADD CONSTRAINT certificate_versions_location_fk
  FOREIGN KEY (dentist_id, location_id)
  REFERENCES care_locations (dentist_id, id);
