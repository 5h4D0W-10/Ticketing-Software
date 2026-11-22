-- 001_baseline.sql
-- Base extensions and migration verification metadata

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS system_metadata (
    key VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO system_metadata (key, value)
VALUES ('system_name', 'Frontdesk Support System')
ON CONFLICT (key) DO NOTHING;

