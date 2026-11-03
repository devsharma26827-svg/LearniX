-- 005_transcription_chunks.sql
CREATE TABLE IF NOT EXISTS transcription_chunks (
  id SERIAL PRIMARY KEY,
  lecture_id VARCHAR(255) NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  chunk_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(lecture_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_transcription_chunks_lookup ON transcription_chunks(lecture_id, sequence_number);
