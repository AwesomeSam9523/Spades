# Spades Tracker

TypeScript-only Spades room tracker with live updates, Google login, leader-controlled flow, and mobile-first hand controls.

## Stack
- Frontend: Next.js (App Router), React, Socket.IO client
- Backend: Express, Passport (Google OAuth), Socket.IO server
- Database: PostgreSQL + Prisma ORM

## Project Structure
- `web/` - Next.js frontend
- `server/` - Express API + Prisma + Socket.IO
- `server/prisma/schema.prisma` - database schema

## Core Game Rules
- Room capacity is max 4 players.
- Each set has 4 rounds.
- Round phases:
1. `CALLING` - players lock calls, leader can start round
2. `PLAYING` - game in progress, leader can end round
3. `ENDED` - players report hands, leader verifies and closes
- Call/report/verify hand values are restricted to `2..13`.
- First call must be locked.
- After locking, calls can increase but not decrease.
- Reporting is only allowed after leader clicks End Round.
- Leader must verify all players before closing and scoring.

## Blind Call
- Blind call can be set during `CALLING` before leader clicks Start Round.
- Blind call must be `>= 5`.
- Blind entries are marked with `*` in called and reported/verified hand display.
- Scoring with blind call:
- Positive score is doubled.
- Negative score is not doubled.

Examples:
- Blind call 5, made 5 -> `100`
- Blind call 5, made 6 -> `102`
- Blind call 5, made 4 -> `-50`

## Scoring
- If verified hands >= called hands:
- `called * 10 + (verified - called)`
- If verified hands < called hands:
- `called * -10`
- If blind call is true and score is positive:
- score is multiplied by `2`

## Room Management
- Leader can kick players.
- Leader can transfer leadership using **Make Leader**.
- Leader cannot kick self.
- If a player is kicked, they are redirected to home immediately.
- Joining a full room returns `Room full (max 4 players)`.

## UI Behavior
- Mobile-first `+ / -` controls for all hand values.
- Non-leaders do not see the Action column in Players table.
- Leader sees Action controls (`Make Leader`, `Kick`).
- Player names are truncated with `...` where needed.
- Roles remain visible.
- Live leaderboard:
- sorted by points
- no serial-number column
- truncated names with fixed points visibility
- leader marked with a crown icon
- Google avatar shown in leaderboard and top-right profile chip.

## Live Updates (WebSocket)
Clients subscribe to room updates and receive:
- `room:update` - full room snapshot
- `leaderboard:update` - leaderboard payload

## API Summary
Auth:
- `GET /auth/google`
- `GET /auth/google/callback`
- `POST /auth/logout`
- `GET /api/auth/me`

Rooms:
- `POST /api/rooms`
- `POST /api/rooms/join`
- `GET /api/rooms/mine`
- `GET /api/rooms/:roomId`
- `DELETE /api/rooms/:roomId/members/:memberId`
- `PATCH /api/rooms/:roomId/leader/:memberId`

Rounds:
- `POST /api/rooms/:roomId/rounds`
- `PATCH /api/rounds/:roundId/call`
- `POST /api/rounds/:roundId/start`
- `POST /api/rounds/:roundId/end`
- `PATCH /api/rounds/:roundId/report`
- `PATCH /api/rounds/:roundId/verify/:memberId`
- `POST /api/rounds/:roundId/close`

## Setup
### 1) Install dependencies
```bash
cd server && npm install
cd ../web && npm install
```

### 2) Configure environment
Create `server/.env`:
```env
PORT=4000
FRONTEND_ORIGIN=http://localhost:3000
SESSION_SECRET=replace-with-a-long-random-string
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:4000/auth/google/callback
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/spades?schema=public
```

Create `web/.env` (optional, default is already `http://localhost:4000`):
```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

### 3) Prepare database
From `server/`:
```bash
npm run prisma:generate
npm run prisma:migrate
```

### 4) Run apps
Terminal 1:
```bash
cd server
npm run dev
```

Terminal 2:
```bash
cd web
npm run dev
```

Frontend: `http://localhost:3000`
Backend: `http://localhost:4000`

## Notes
- Session store currently uses in-memory `express-session` (good for local/offline play).
- For production, use a persistent session store (e.g. Redis).
