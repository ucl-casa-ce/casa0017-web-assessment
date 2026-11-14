# Backend API

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `DB_HOST` | MySQL host |
| `DB_USER` | MySQL username |
| `DB_PASSWORD` | MySQL password |
| `DB_NAME` | Database name |
| `DB_PORT` | MySQL port (default: 3306) |
| `DB_SSL` | Enable SSL for database (set `true` for TiDB Cloud) |
| `CORS_ORIGIN` | Allowed CORS origin |
| `CRON_ENABLED` | Enable/disable cron jobs |

## Commands

```bash
npm run dev      # Start with hot reload (development)
npm run start    # Start server (production)
npm run seed     # Seed outfalls data
```
