const express = require('express');
const pool = require('./db');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;
const VISIBILITY = ['yes', 'partly', 'no'];

// начало сегодняшнего дня по алматинскому времени
const TODAY_START = `date_trunc('day', now() AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'Asia/Almaty'`;

// express 4 сам не ловит ошибки из async-функций
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// yes = 1, partly = 0.5, no = 0
function score(c) {
  if (!c.total) return null;
  return Math.round(((c.yes + c.partly * 0.5) / c.total) * 100);
}

function verdict(s) {
  if (s === null) return 'сегодня ещё никто не смотрел в окно';
  if (s >= 70) return 'горы видно, хороший день для прогулки';
  if (s >= 35) return 'дымка, горы еле угадываются';
  return 'гор не видно, лучше закрыть окна';
}

app.get('/', (req, res) => {
  res.json({
    name: 'Видно горы?',
    about: 'Алматинцы отмечают, видно ли сегодня горы из их района. Не видно — значит смог.',
    endpoints: ['GET /districts', 'GET /reports', 'POST /reports', 'GET /today', 'GET /health'],
  });
});

app.get('/health', wrap(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
}));

app.get('/districts', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT slug, name FROM districts ORDER BY name');
  res.json(rows);
}));

app.get('/reports', wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const district = req.query.district || null;

  const { rows } = await pool.query(
    `SELECT r.id, d.slug AS district, d.name AS district_name,
            r.visibility, r.comment, r.created_at
     FROM reports r
     JOIN districts d ON d.id = r.district_id
     WHERE $1::text IS NULL OR d.slug = $1
     ORDER BY r.created_at DESC
     LIMIT $2`,
    [district, limit]
  );
  res.json(rows);
}));

app.post('/reports', wrap(async (req, res) => {
  const { district, visibility, comment } = req.body || {};

  if (!VISIBILITY.includes(visibility)) {
    return res.status(400).json({ error: `visibility: одно из ${VISIBILITY.join(', ')}` });
  }
  if (comment != null && (typeof comment !== 'string' || comment.length > 280)) {
    return res.status(400).json({ error: 'comment: строка до 280 символов' });
  }

  const { rows } = await pool.query(
    `INSERT INTO reports (district_id, visibility, comment)
     SELECT id, $2, $3 FROM districts WHERE slug = $1
     RETURNING id, visibility, comment, created_at`,
    [district, visibility, comment || null]
  );

  if (rows.length === 0) {
    return res.status(400).json({ error: `нет такого района: ${district}, список в GET /districts` });
  }
  res.status(201).json({ district, ...rows[0] });
}));

app.get('/today', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.slug, d.name,
            count(r.id)::int AS total,
            count(*) FILTER (WHERE r.visibility = 'yes')::int    AS yes,
            count(*) FILTER (WHERE r.visibility = 'partly')::int AS partly,
            count(*) FILTER (WHERE r.visibility = 'no')::int     AS hidden
     FROM districts d
     LEFT JOIN reports r ON r.district_id = d.id AND r.created_at >= ${TODAY_START}
     GROUP BY d.id
     ORDER BY d.name`
  );

  const city = { total: 0, yes: 0, partly: 0 };
  for (const d of rows) {
    city.total += d.total;
    city.yes += d.yes;
    city.partly += d.partly;
  }
  const cityScore = score(city);

  res.json({
    city: { reports: city.total, score: cityScore, verdict: verdict(cityScore) },
    districts: rows.map((d) => {
      const s = score(d);
      return {
        district: d.slug,
        name: d.name,
        reports: d.total,
        votes: { yes: d.yes, partly: d.partly, no: d.hidden },
        score: s,
        verdict: verdict(s),
      };
    }),
  });
}));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'кривой JSON в теле запроса' });
  }
  console.error(err);
  res.status(500).json({ error: 'ошибка на сервере' });
});

const server = app.listen(PORT, () => {
  console.log(`api запущен на порту ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => pool.end().then(() => process.exit(0)));
});
