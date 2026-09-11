CREATE TABLE IF NOT EXISTS astra_scans (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object')
);
CREATE INDEX IF NOT EXISTS astra_scans_created_at ON astra_scans (created_at DESC);
CREATE INDEX IF NOT EXISTS astra_scans_status ON astra_scans (status);
