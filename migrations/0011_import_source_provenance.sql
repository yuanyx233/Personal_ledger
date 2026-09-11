ALTER TABLE import_batches ADD COLUMN source_filename_hash TEXT CHECK (
  source_filename_hash IS NULL OR
  (
    length(source_filename_hash) = 64
    AND source_filename_hash NOT GLOB '*[^a-f0-9]*'
  )
);
