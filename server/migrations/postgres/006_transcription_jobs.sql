-- 006_transcription_jobs.sql
CREATE TABLE IF NOT EXISTS transcription_jobs (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lecture_id VARCHAR(255) NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  audio_ref TEXT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  duration_seconds NUMERIC(10, 2) NOT NULL DEFAULT 0,
  start_time NUMERIC(10, 2) NOT NULL DEFAULT 0,
  end_time NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at BIGINT NOT NULL DEFAULT 0,
  last_error_code VARCHAR(100),
  last_error_message TEXT,
  chunk_hash VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_user_id ON transcription_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_lecture_id ON transcription_jobs(lecture_id);
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_status_retry ON transcription_jobs(status, next_retry_at);
