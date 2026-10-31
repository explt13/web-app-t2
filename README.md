# Видно горы?

В Алматы качество воздуха проще всего проверить, выглянув в окно: если горы видно, дышать можно, если нет, над городом смог. Этот сервис собирает такие наблюдения от жителей по районам и выдаёт сводку за сегодня.

REST API на Node.js (Express) и PostgreSQL, всё запускается через Docker Compose.

## Архитектура

```
  Postman / браузер
        │  localhost:8080
        ▼
┌──────────────┐   сеть backend   ┌──────────────┐
│ api          │ ───────────────▶ │ db           │
│ Node.js      │     db:5432      │ PostgreSQL   │
│ порт 3000    │                  │              │
└──────────────┘                  └──────┬───────┘
                                         │
                                  volume pgdata
```

- `api` собирается из `api/Dockerfile`, наружу открыт только его порт (`APP_PORT` → 3000).
- `db` — официальный образ `postgres:17-alpine`, снаружи недоступен. API обращается к нему по имени сервиса `db` внутри сети `backend`.
- Данные базы лежат в named volume `pgdata` и переживают пересоздание контейнеров.
- `api` стартует только после того, как healthcheck базы (`pg_isready`) прошёл успешно.
- При первом запуске `db/init.sql` создаёт таблицы `districts` и `reports` и заполняет районы.

## Запуск

```bash
cp .env.example .env    # и поменять пароль
docker compose up
```

API будет доступен на http://localhost:8080. После изменений в коде запускать с `--build`.

Остановить: `Ctrl + C`, затем `docker compose down`. Данные останутся в volume. Полностью сбросить базу: `docker compose down -v`.

## Переменные окружения

| Переменная | Где используется | Пример |
|---|---|---|
| `POSTGRES_DB` | имя базы, для db и api | `vidno_gory` |
| `POSTGRES_USER` | пользователь базы | `gory` |
| `POSTGRES_PASSWORD` | пароль базы | — |
| `APP_PORT` | порт API на хосте | `8080` |

В контейнер `api` они попадают как `DB_NAME`, `DB_USER`, `DB_PASSWORD`, плюс `DB_HOST=db` и `DB_PORT=5432` (см. `compose.yaml`). `.env` в Git не коммитится, в репозитории только `.env.example`.

## API

| Метод | Путь | Описание |
|---|---|---|
| GET | `/reports` | список наблюдений |
| GET | `/reports/:id` | наблюдение по id |
| POST | `/reports` | создать наблюдение |
| PUT | `/reports/:id` | изменить наблюдение |
| DELETE | `/reports/:id` | удалить наблюдение |
| GET | `/districts` | районы Алматы |
| GET | `/today` | сводка видимости гор за сегодня |
| GET | `/health` | проверка связи с базой |

Подробное описание с примерами: [docs/API.md](docs/API.md).

Postman-коллекция: [postman/vidno-gory.postman_collection.json](postman/vidno-gory.postman_collection.json). В Postman: Import → выбрать файл. Адрес сервера задаётся переменной коллекции `baseUrl`.

## Структура

```
compose.yaml
.env.example
db/init.sql                  схема базы и список районов
api/Dockerfile
api/.dockerignore
api/package.json
api/src/server.js            эндпоинты
api/src/db.js                подключение к Postgres
docs/API.md                  документация API
postman/                     коллекция для Postman
```
