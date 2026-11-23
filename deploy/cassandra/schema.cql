CREATE TABLE IF NOT EXISTS links (
    code text PRIMARY KEY,
    destination text,
    created_at timestamp,
    expires_at timestamp
);

CREATE TABLE IF NOT EXISTS reservations (
    installation text PRIMARY KEY,
    next_free bigint,
    authorized_until bigint,
    fingerprint text,
    epoch uuid
) WITH default_time_to_live = 0;
