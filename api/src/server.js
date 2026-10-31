const express = require('express');
const pool = require('./db');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;
const VISIBILITY = ['yes', 'partly', 'no'];

// начало сегодняшнего дня по алматинскому времени
const TODAY_START = `date_trunc('day', now() AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'Asia/Almaty'`;

const REPORT_SELECT = `
  SELECT r.id, d.slug AS district, d.name AS district_name,
         r.visibility, r.comment, r.created_at
  FROM reports r
  JOIN districts d ON d.id = r.district_id`;

// express 4 сам не ловит ошибки из async-функций
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

// общая проверка тела для POST и PUT
function validateBody(body) {
  const { district, visibility, comment } = body || {};
  if (typeof district !== 'string' || !district) {
    return 'district: slug района, список в GET /districts';
  }
  if (!VISIBILITY.includes(visibility)) {
    return `visibility: одно из ${VISIBILITY.join(', ')}`;
  }
  if (comment != null && (typeof comment !== 'string' || comment.length > 280)) {
    return 'comment: строка до 280 символов';
  }
  return null;
}

async function findDistrictId(slug) {
  const { rows } = await pool.query('SELECT id FROM districts WHERE slug = $1', [slug]);
  return rows.length ? rows[0].id : null;
}

async function findReport(id) {
  const { rows } = await pool.query(`${REPORT_SELECT} WHERE r.id = $1`, [id]);
  return rows[0] || null;
}

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
    docs: 'docs/API.md в репозитории',
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
    `${REPORT_SELECT}
     WHERE $1::text IS NULL OR d.slug = $1
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $2`,
    [district, limit]
  );
  res.json(rows);
}));

app.get('/reports/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id должен быть положительным целым числом' });

  const report = await findReport(id);
  if (!report) return res.status(404).json({ error: `наблюдение ${id} не найдено` });
  res.json(report);
}));

app.post('/reports', wrap(async (req, res) => {
  const error = validateBody(req.body);
  if (error) return res.status(400).json({ error });

  const { district, visibility, comment } = req.body;
  const districtId = await findDistrictId(district);
  if (!districtId) {
    return res.status(400).json({ error: `нет такого района: ${district}, список в GET /districts` });
  }

  const { rows } = await pool.query(
    'INSERT INTO reports (district_id, visibility, comment) VALUES ($1, $2, $3) RETURNING id',
    [districtId, visibility, comment || null]
  );
  res.status(201).json(await findReport(rows[0].id));
}));

app.put('/reports/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id должен быть положительным целым числом' });

  const error = validateBody(req.body);
  if (error) return res.status(400).json({ error });

  const { district, visibility, comment } = req.body;
  const districtId = await findDistrictId(district);
  if (!districtId) {
    return res.status(400).json({ error: `нет такого района: ${district}, список в GET /districts` });
  }

  const { rowCount } = await pool.query(
    'UPDATE reports SET district_id = $1, visibility = $2, comment = $3 WHERE id = $4',
    [districtId, visibility, comment || null, id]
  );
  if (!rowCount) return res.status(404).json({ error: `наблюдение ${id} не найдено` });
  res.json(await findReport(id));
}));

app.delete('/reports/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id должен быть положительным целым числом' });

  const { rowCount } = await pool.query('DELETE FROM reports WHERE id = $1', [id]);
  if (!rowCount) return res.status(404).json({ error: `наблюдение ${id} не найдено` });
  res.status(204).end();
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

app.use((req, res) => {
  res.status(404).json({ error: `нет такого эндпоинта: ${req.method} ${req.path}` });
});

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
