# Spades Tracker (Next.js + Express + Prisma + Postgres)

TypeScript-only app for offline Spades score tracking with:
- Google login for persistent user progress
- Room system using 6-character join codes
- Room capacity: max 4 players
- Room leader verification for all hands before round close
- Locked call rule: initial call must be locked; after lock it can increase but not decrease
- Set flow: each set is 4 rounds
- Hands range is restricted to 2-13
- Blind call available during calling phase (minimum blind call is 5, doubles positive score only)
- Live leaderboard updates via WebSocket

## Tech stack
- Frontend: Next.js (App Router), React, Socket.IO client
- Backend: Express, Passport Google OAuth, Socket.IO server
- Database: PostgreSQL + Prisma ORM

## Project layout
- `/Users/samakshgupta/IdeaProjects/Spades/apps/web` - Next.js UI
- `/Users/samakshgupta/IdeaProjects/Spades/apps/server` - Express API, auth, and game engine
- `/Users/samakshgupta/IdeaProjects/Spades/apps/server/prisma/schema.prisma` - DB schema

## Scoring rule implemented
- If verified hands >= called hands: `called * 10 + (verified - called)`
- If verified hands < called hands: `called * -10`

Example: called 4, made 6 => `4 * 10 + 2 = 42`
Example: called 4, made 3 => `-40`

## Setup
1. Install dependencies:
```bash
npm install
```

2. Start PostgreSQL (Docker):
```bash
docker compose up -d
```

3. Configure env files:
```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env apps/web/.env.local
```

4. Create a Google OAuth app and set callback URL to:
- `http://localhost:4000/auth/google/callback`

5. Run Prisma migration:
```bash
npm run prisma:migrate
npm run prisma:generate
```

6. Start both apps:
```bash
npm run dev
```

## Core API flow
- `GET /auth/google` - login with Google
- `POST /api/rooms` - create room (creator becomes leader)
- `POST /api/rooms/join` - join room by code
- `DELETE /api/rooms/:roomId/members/:memberId` - leader kicks a player
- `POST /api/rooms/:roomId/rounds` - leader starts round
- `POST /api/rounds/:roundId/start` - leader starts play after everyone locks calls
- `POST /api/rounds/:roundId/end` - leader ends play; only then reporting is allowed
- `PATCH /api/rounds/:roundId/call` - player locks or increases call
- `PATCH /api/rounds/:roundId/report` - player reports winning hands
- `PATCH /api/rounds/:roundId/verify/:memberId` - leader verifies a player’s hands
- `POST /api/rounds/:roundId/close` - leader closes round and awards points

## Live updates
Frontend subscribes to room events through Socket.IO and receives:
- `room:update` (full room snapshot)
- `leaderboard:update` (leaderboard payload)

## Notes
- Session store is in-memory (`express-session` default), suitable for local/offline use.
- For production, replace it with Redis or another persistent session store.
