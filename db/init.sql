CREATE TABLE districts (
    id   SERIAL PRIMARY KEY,
    slug VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL
);

CREATE TABLE reports (
    id          SERIAL PRIMARY KEY,
    district_id INT NOT NULL REFERENCES districts(id),
    visibility  VARCHAR(10) NOT NULL CHECK (visibility IN ('yes', 'partly', 'no')),
    comment     VARCHAR(280),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reports_created_at_idx ON reports (created_at);

INSERT INTO districts (slug, name) VALUES
    ('alatau',    'Алатауский'),
    ('almaly',    'Алмалинский'),
    ('auezov',    'Ауэзовский'),
    ('bostandyk', 'Бостандыкский'),
    ('zhetysu',   'Жетысуский'),
    ('medeu',     'Медеуский'),
    ('nauryzbay', 'Наурызбайский'),
    ('turksib',   'Турксибский');
