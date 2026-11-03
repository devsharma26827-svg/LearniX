-- 002_upgrade_user_columns.sql
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='password_hash') THEN
    ALTER TABLE users ADD COLUMN password_hash TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lectures' AND column_name='teacher_id') THEN
    ALTER TABLE lectures ADD COLUMN teacher_id VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lectures' AND column_name='subject_id') THEN
    ALTER TABLE lectures ADD COLUMN subject_id VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lectures' AND column_name='language') THEN
    ALTER TABLE lectures ADD COLUMN language VARCHAR(50) DEFAULT 'auto';
  END IF;
END $$;
