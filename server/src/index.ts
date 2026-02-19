import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import {createServer} from "node:http";
import passport from "passport";
import {Strategy as GoogleStrategy} from "passport-google-oauth20";
import {Server as SocketIOServer} from "socket.io";
import {z} from "zod";
import {prisma} from "./utils/prisma.js";
import {requireAuth} from "./middleware/auth.js";
import {createAuthToken} from "./utils/authToken.js";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  JWT_SECRET: z.string().min(16),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 14),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).optional(),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  GOOGLE_CALLBACK_URL: z.string().url()
});

const env = envSchema.parse(process.env);
const cookieSameSite = env.COOKIE_SAME_SITE ?? (process.env.NODE_ENV === "production" ? "none" : "lax");
const cookieSecure = cookieSameSite === "none"
  ? true
  : env.COOKIE_SECURE
    ? env.COOKIE_SECURE === "true"
    : process.env.NODE_ENV === "production";
const authCookieOptions = {
  httpOnly: true,
  sameSite: cookieSameSite,
  secure: cookieSecure,
  maxAge: env.JWT_TTL_SECONDS * 1000,
  path: "/"
} as const;
const authCookieClearOptions = {
  httpOnly: true,
  sameSite: cookieSameSite,
  secure: cookieSecure,
  path: "/"
} as const;

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: env.FRONTEND_ORIGIN,
    credentials: true
  }
});

app.use(cors({origin: env.FRONTEND_ORIGIN, credentials: true}));
app.use(express.json());
app.use(cookieParser());
app.set("trust proxy", 1);

app.use(passport.initialize());

passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: env.GOOGLE_CALLBACK_URL
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) {
          done(new Error("Google account does not include an email"));
          return;
        }

        const user = await prisma.user.upsert({
          where: {googleId: profile.id},
          update: {
            email,
            name: profile.displayName,
            avatarUrl: profile.photos?.[0]?.value ?? null
          },
          create: {
            googleId: profile.id,
            email,
            name: profile.displayName,
            avatarUrl: profile.photos?.[0]?.value ?? null
          }
        });

        done(null, {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl
        });
      } catch (error) {
        done(error as Error);
      }
    }
  )
);

const roomCodeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_MAX_PLAYERS = 4;
const MIN_HANDS = 2;
const MAX_HANDS = 13;
const BLIND_MIN_HANDS = 5;

const generateRoomCode = (): string => {
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    const index = Math.floor(Math.random() * roomCodeChars.length);
    code += roomCodeChars[index];
  }
  return code;
};

const createUniqueRoomCode = async (): Promise<string> => {
  while (true) {
    const code = generateRoomCode();
    const existing = await prisma.room.findUnique({where: {code}});
    if (!existing) {
      return code;
    }
  }
};

const roundCallSchema = z.object({
  calledHands: z.number().int().min(MIN_HANDS).max(MAX_HANDS),
  blindCall: z.boolean().optional(),
  lock: z.boolean().optional().default(false)
});

const reportSchema = z.object({
  winningHands: z.number().int().min(MIN_HANDS).max(MAX_HANDS)
});

const verifySchema = z.object({
  verifiedWinningHands: z.number().int().min(MIN_HANDS).max(MAX_HANDS).optional()
});

const computeRoundPoints = (calledHands: number, verifiedHands: number, blindCall: boolean): number => {
  if (verifiedHands < calledHands) {
    return calledHands * -10;
  }

  const basePoints = calledHands * 10 + (verifiedHands - calledHands);
  return blindCall ? basePoints * 2 : basePoints;
};

const getRoomSnapshot = async (roomId: string) => {
  const room = await prisma.room.findUnique({
    where: {id: roomId},
    include: {
      members: {
        include: {
          user: true
        },
        orderBy: {joinedAt: "asc"}
      },
      rounds: {
        include: {
          entries: {
            include: {
              member: {
                include: {
                  user: true
                }
              }
            },
            orderBy: {member: {joinedAt: "asc"}}
          }
        },
        orderBy: {roundNumber: "asc"}
      }
    }
  });

  if (!room) {
    return null;
  }

  const members = room.members.map((member) => ({
    memberId: member.id,
    userId: member.userId,
    displayName: member.user.name ?? member.user.email,
    email: member.user.email,
    avatarUrl: member.user.avatarUrl,
    totalPoints: member.totalPoints,
    isLeader: member.userId === room.leaderId
  }));

  const leaderboard = [...members].sort((a, b) => b.totalPoints - a.totalPoints);

  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      status: room.status,
      leaderId: room.leaderId,
      createdAt: room.createdAt
    },
    members,
    rounds: room.rounds.map((round) => ({
      id: round.id,
      roundNumber: round.roundNumber,
      state: round.state,
      phase: round.phase,
      createdAt: round.createdAt,
      startedAt: round.startedAt,
      endedAt: round.endedAt,
      closedAt: round.closedAt,
      entries: round.entries.map((entry) => ({
        entryId: entry.id,
        memberId: entry.memberId,
        userId: entry.member.userId,
        displayName: entry.member.user.name ?? entry.member.user.email,
        calledHands: entry.calledHands,
        blindCall: entry.blindCall,
        locked: Boolean(entry.lockedAt),
        reportedWinningHands: entry.reportedWinningHands,
        verifiedWinningHands: entry.verifiedWinningHands,
        verifiedById: entry.verifiedById,
        pointsAwarded: entry.pointsAwarded
      }))
    })),
    leaderboard
  };
};

const emitRoomUpdate = async (roomId: string): Promise<void> => {
  const snapshot = await getRoomSnapshot(roomId);
  if (!snapshot) {
    return;
  }

  io.to(roomId).emit("room:update", snapshot);
  io.to(roomId).emit("leaderboard:update", {
    roomId,
    leaderboard: snapshot.leaderboard
  });
};

const requireRoomMembership = async (roomId: string, userId: string) => {
  return prisma.roomMember.findUnique({
    where: {
      roomId_userId: {
        roomId,
        userId
      }
    }
  });
};

io.on("connection", (socket) => {
  socket.on("room:subscribe", async (payload: { roomId?: string }) => {
    if (!payload?.roomId) {
      return;
    }

    socket.join(payload.roomId);
    await emitRoomUpdate(payload.roomId);
  });

  socket.on("room:unsubscribe", (payload: { roomId?: string }) => {
    if (!payload?.roomId) {
      return;
    }

    socket.leave(payload.roomId);
  });
});

app.get("/health", (_req, res) => {
  res.json({status: "ok"});
});

app.get("/auth/google", passport.authenticate("google", {scope: ["profile", "email"], session: false}));

app.get(
  "/auth/google/callback",
  (req, res, next) => {
    passport.authenticate(
      "google",
      {failureRedirect: `${env.FRONTEND_ORIGIN}/?login=failed`, session: false},
      (error: Error | null, user: Express.User | false) => {
        if (error || !user) {
          res.redirect(`${env.FRONTEND_ORIGIN}/?login=failed`);
          return;
        }

        const authToken = createAuthToken(
          {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl
          },
          env.JWT_SECRET,
          env.JWT_TTL_SECONDS
        );

        res.cookie("auth_token", authToken, authCookieOptions);
        res.redirect(`${env.FRONTEND_ORIGIN}/`);
      }
    )(req, res, next);
  }
);

app.post("/auth/logout", (_req, res) => {
  res.clearCookie("auth_token", authCookieClearOptions);
  res.status(204).send();
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({user: req.user!});
});

app.post("/api/rooms", requireAuth, async (req, res, next) => {
  try {
    const name = typeof req.body?.name === "string" && req.body.name.trim().length > 0 ? req.body.name.trim() : "Spades Room";
    const code = await createUniqueRoomCode();

    const room = await prisma.$transaction(async (tx) => {
      const createdRoom = await tx.room.create({
        data: {
          code,
          name,
          leaderId: req.user!.id
        }
      });

      await tx.roomMember.create({
        data: {
          roomId: createdRoom.id,
          userId: req.user!.id
        }
      });

      return createdRoom;
    });

    await emitRoomUpdate(room.id);
    const snapshot = await getRoomSnapshot(room.id);
    res.status(201).json(snapshot);
  } catch (error) {
    next(error);
  }
});

app.post("/api/rooms/join", requireAuth, async (req, res, next) => {
  try {
    const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
    if (!code) {
      res.status(400).json({error: "Room code is required"});
      return;
    }

    const room = await prisma.room.findUnique({
      where: {code},
      include: {
        rounds: {
          where: {state: "IN_PROGRESS"}
        }
      }
    });
    if (!room) {
      res.status(404).json({error: "Room not found"});
      return;
    }

    if (room.rounds.length > 0) {
      res.status(400).json({error: "Cannot join while a round is in progress"});
      return;
    }

    const existingMembership = await prisma.roomMember.findUnique({
      where: {
        roomId_userId: {
          roomId: room.id,
          userId: req.user!.id
        }
      }
    });

    if (!existingMembership) {
      const memberCount = await prisma.roomMember.count({
        where: {roomId: room.id}
      });

      if (memberCount >= ROOM_MAX_PLAYERS) {
        res.status(400).json({error: "Room full (max 4 players)"});
        return;
      }

      await prisma.roomMember.create({
        data: {
          roomId: room.id,
          userId: req.user!.id
        }
      });
    }

    await emitRoomUpdate(room.id);
    const snapshot = await getRoomSnapshot(room.id);
    res.json(snapshot);
  } catch (error) {
    next(error);
  }
});

app.get("/api/rooms/mine", requireAuth, async (req, res, next) => {
  try {
    const memberships = await prisma.roomMember.findMany({
      where: {userId: req.user!.id},
      include: {
        room: true
      },
      orderBy: {
        joinedAt: "desc"
      }
    });

    res.json({
      rooms: memberships.map((membership) => ({
        roomId: membership.roomId,
        roomName: membership.room.name,
        roomCode: membership.room.code,
        joinedAt: membership.joinedAt
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/rooms/:roomId", requireAuth, async (req, res, next) => {
  try {
    const membership = await requireRoomMembership(req.params.roomId, req.user!.id);
    if (!membership) {
      res.status(403).json({error: "You are not a member of this room"});
      return;
    }

    const snapshot = await getRoomSnapshot(req.params.roomId);
    if (!snapshot) {
      res.status(404).json({error: "Room not found"});
      return;
    }

    res.json(snapshot);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/rooms/:roomId/members/:memberId", requireAuth, async (req, res, next) => {
  try {
    const room = await prisma.room.findUnique({
      where: {id: req.params.roomId}
    });

    if (!room) {
      res.status(404).json({error: "Room not found"});
      return;
    }

    if (room.leaderId !== req.user!.id) {
      res.status(403).json({error: "Only the room leader can kick players"});
      return;
    }

    const targetMember = await prisma.roomMember.findUnique({
      where: {id: req.params.memberId}
    });

    if (!targetMember || targetMember.roomId !== room.id) {
      res.status(404).json({error: "Player not found in this room"});
      return;
    }

    if (targetMember.userId === room.leaderId) {
      res.status(400).json({error: "Room leader cannot be kicked"});
      return;
    }

    await prisma.roomMember.delete({
      where: {id: targetMember.id}
    });

    await emitRoomUpdate(room.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.patch("/api/rooms/:roomId/leader/:memberId", requireAuth, async (req, res, next) => {
  try {
    const room = await prisma.room.findUnique({
      where: {id: req.params.roomId}
    });

    if (!room) {
      res.status(404).json({error: "Room not found"});
      return;
    }

    if (room.leaderId !== req.user!.id) {
      res.status(403).json({error: "Only the current leader can transfer leadership"});
      return;
    }

    const targetMember = await prisma.roomMember.findUnique({
      where: {id: req.params.memberId}
    });

    if (!targetMember || targetMember.roomId !== room.id) {
      res.status(404).json({error: "Player not found in this room"});
      return;
    }

    if (targetMember.userId === room.leaderId) {
      res.status(400).json({error: "Player is already the leader"});
      return;
    }

    await prisma.room.update({
      where: {id: room.id},
      data: {
        leaderId: targetMember.userId
      }
    });

    await emitRoomUpdate(room.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/rooms/:roomId/rounds", requireAuth, async (req, res, next) => {
  try {
    const room = await prisma.room.findUnique({
      where: {id: req.params.roomId},
      include: {
        members: true,
        rounds: {
          where: {state: "IN_PROGRESS"}
        }
      }
    });

    if (!room) {
      res.status(404).json({error: "Room not found"});
      return;
    }

    if (room.leaderId !== req.user!.id) {
      res.status(403).json({error: "Only the room leader can start rounds"});
      return;
    }

    if (room.rounds.length > 0) {
      res.status(400).json({error: "Finish the active round first"});
      return;
    }

    const lastRound = await prisma.round.findFirst({
      where: {roomId: room.id},
      orderBy: {roundNumber: "desc"}
    });

    const round = await prisma.$transaction(async (tx) => {
      const createdRound = await tx.round.create({
        data: {
          roomId: room.id,
          roundNumber: (lastRound?.roundNumber ?? 0) + 1
        }
      });

      await tx.room.update({
        where: {id: room.id},
        data: {status: "IN_PROGRESS"}
      });

      await tx.roundEntry.createMany({
        data: room.members.map((member) => ({
          roundId: createdRound.id,
          memberId: member.id
        }))
      });

      return createdRound;
    });

    await emitRoomUpdate(room.id);
    res.status(201).json({roundId: round.id});
  } catch (error) {
    next(error);
  }
});

app.patch("/api/rounds/:roundId/call", requireAuth, async (req, res, next) => {
  try {
    const parsed = roundCallSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({error: "Invalid call payload"});
      return;
    }

    const entry = await prisma.roundEntry.findFirst({
      where: {
        roundId: req.params.roundId,
        member: {
          userId: req.user!.id
        }
      },
      include: {
        round: true,
        member: true
      }
    });

    if (!entry) {
      res.status(404).json({error: "Round entry not found"});
      return;
    }

    if (entry.round.state !== "IN_PROGRESS") {
      res.status(400).json({error: "Round is already closed"});
      return;
    }

    if (entry.round.phase !== "CALLING") {
      res.status(400).json({error: "Calling phase has ended"});
      return;
    }

    const {calledHands, blindCall: requestedBlindCall, lock} = parsed.data;
    const blindCall = requestedBlindCall ?? entry.blindCall;

    if (blindCall && calledHands < BLIND_MIN_HANDS) {
      res.status(400).json({error: "Blind call must be at least 5 hands"});
      return;
    }

    if (!entry.lockedAt) {
      if (!lock) {
        res.status(400).json({error: "Initial estimate must be locked"});
        return;
      }

      await prisma.roundEntry.update({
        where: {id: entry.id},
        data: {
          calledHands,
          blindCall,
          lockedAt: new Date()
        }
      });
    } else {
      if (calledHands < entry.calledHands) {
        res.status(400).json({error: "Locked estimate cannot be decreased"});
        return;
      }

      await prisma.roundEntry.update({
        where: {id: entry.id},
        data: {
          calledHands,
          blindCall
        }
      });
    }

    await emitRoomUpdate(entry.round.roomId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/rounds/:roundId/start", requireAuth, async (req, res, next) => {
  try {
    const round = await prisma.round.findUnique({
      where: {id: req.params.roundId},
      include: {
        room: true,
        entries: true
      }
    });

    if (!round) {
      res.status(404).json({error: "Round not found"});
      return;
    }

    if (round.room.leaderId !== req.user!.id) {
      res.status(403).json({error: "Only the room leader can start the round"});
      return;
    }

    if (round.state !== "IN_PROGRESS") {
      res.status(400).json({error: "Round is already closed"});
      return;
    }

    if (round.phase !== "CALLING") {
      res.status(400).json({error: "Round has already started"});
      return;
    }

    const missingCalls = round.entries.find((entry) => !entry.lockedAt);
    if (missingCalls) {
      res.status(400).json({error: "All players must lock their calls before starting the round"});
      return;
    }

    await prisma.round.update({
      where: {id: round.id},
      data: {
        phase: "PLAYING",
        startedAt: new Date()
      }
    });

    await emitRoomUpdate(round.roomId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/rounds/:roundId/end", requireAuth, async (req, res, next) => {
  try {
    const round = await prisma.round.findUnique({
      where: {id: req.params.roundId},
      include: {
        room: true
      }
    });

    if (!round) {
      res.status(404).json({error: "Round not found"});
      return;
    }

    if (round.room.leaderId !== req.user!.id) {
      res.status(403).json({error: "Only the room leader can end the round"});
      return;
    }

    if (round.state !== "IN_PROGRESS") {
      res.status(400).json({error: "Round is already closed"});
      return;
    }

    if (round.phase !== "PLAYING") {
      res.status(400).json({error: "Round must be in playing phase before ending"});
      return;
    }

    await prisma.round.update({
      where: {id: round.id},
      data: {
        phase: "ENDED",
        endedAt: new Date()
      }
    });

    await emitRoomUpdate(round.roomId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.patch("/api/rounds/:roundId/report", requireAuth, async (req, res, next) => {
  try {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({error: "Invalid report payload"});
      return;
    }

    const entry = await prisma.roundEntry.findFirst({
      where: {
        roundId: req.params.roundId,
        member: {
          userId: req.user!.id
        }
      },
      include: {
        round: true
      }
    });

    if (!entry) {
      res.status(404).json({error: "Round entry not found"});
      return;
    }

    if (entry.round.state !== "IN_PROGRESS") {
      res.status(400).json({error: "Round is already closed"});
      return;
    }

    if (entry.round.phase !== "ENDED") {
      res.status(400).json({error: "You can report hands only after the leader ends the round"});
      return;
    }

    await prisma.roundEntry.update({
      where: {id: entry.id},
      data: {
        reportedWinningHands: parsed.data.winningHands
      }
    });

    await emitRoomUpdate(entry.round.roomId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.patch("/api/rounds/:roundId/verify/:memberId", requireAuth, async (req, res, next) => {
  try {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({error: "Invalid verification payload"});
      return;
    }

    const round = await prisma.round.findUnique({
      where: {id: req.params.roundId},
      include: {
        room: true
      }
    });

    if (!round) {
      res.status(404).json({error: "Round not found"});
      return;
    }

    if (round.room.leaderId !== req.user!.id) {
      res.status(403).json({error: "Only the room leader can verify hands"});
      return;
    }

    if (round.state !== "IN_PROGRESS") {
      res.status(400).json({error: "Round is already closed"});
      return;
    }

    if (round.phase !== "ENDED") {
      res.status(400).json({error: "Verification is available only after the round is ended"});
      return;
    }

    const entry = await prisma.roundEntry.findFirst({
      where: {
        roundId: round.id,
        memberId: req.params.memberId
      }
    });

    if (!entry) {
      res.status(404).json({error: "Round entry not found"});
      return;
    }

    if (entry.reportedWinningHands == null) {
      res.status(400).json({error: "Player has not reported winning hands yet"});
      return;
    }

    const verifiedWinningHands = parsed.data.verifiedWinningHands ?? entry.reportedWinningHands;

    await prisma.roundEntry.update({
      where: {id: entry.id},
      data: {
        verifiedWinningHands,
        verifiedById: req.user!.id
      }
    });

    await emitRoomUpdate(round.roomId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/rounds/:roundId/close", requireAuth, async (req, res, next) => {
  try {
    const round = await prisma.round.findUnique({
      where: {id: req.params.roundId},
      include: {
        room: true,
        entries: {
          include: {
            member: true
          }
        }
      }
    });

    if (!round) {
      res.status(404).json({error: "Round not found"});
      return;
    }

    if (round.room.leaderId !== req.user!.id) {
      res.status(403).json({error: "Only the room leader can close rounds"});
      return;
    }

    if (round.state !== "IN_PROGRESS") {
      res.status(400).json({error: "Round already closed"});
      return;
    }

    if (round.phase !== "ENDED") {
      res.status(400).json({error: "Round must be ended before closing and scoring"});
      return;
    }

    const unverified = round.entries.find((entry) => entry.verifiedWinningHands == null);
    if (unverified) {
      res.status(400).json({error: "All hands must be verified before closing the round"});
      return;
    }

    const roundResult = await prisma.$transaction(async (tx) => {
      const scoredEntries = await Promise.all(
        round.entries.map(async (entry) => {
          const points = computeRoundPoints(entry.calledHands, entry.verifiedWinningHands ?? 0, entry.blindCall);

          await tx.roundEntry.update({
            where: {id: entry.id},
            data: {pointsAwarded: points}
          });

          await tx.roomMember.update({
            where: {id: entry.memberId},
            data: {
              totalPoints: {
                increment: points
              }
            }
          });

          return {
            memberId: entry.memberId,
            points
          };
        })
      );

      await tx.round.update({
        where: {id: round.id},
        data: {
          state: "CLOSED",
          closedAt: new Date()
        }
      });

      await tx.room.update({
        where: {id: round.roomId},
        data: {
          status: "LOBBY"
        }
      });

      return scoredEntries;
    });

    await emitRoomUpdate(round.roomId);
    res.json({
      roundId: round.id,
      scores: roundResult
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/rooms/:roomId/leaderboard", requireAuth, async (req, res, next) => {
  try {
    const membership = await requireRoomMembership(req.params.roomId, req.user!.id);
    if (!membership) {
      res.status(403).json({error: "You are not a member of this room"});
      return;
    }

    const members = await prisma.roomMember.findMany({
      where: {roomId: req.params.roomId},
      include: {
        user: true,
        room: true
      },
      orderBy: [{totalPoints: "desc"}, {joinedAt: "asc"}]
    });

    res.json({
      leaderboard: members.map((member) => ({
        memberId: member.id,
        userId: member.userId,
        displayName: member.user.name ?? member.user.email,
        totalPoints: member.totalPoints,
        isLeader: member.userId === member.room.leaderId
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(error);
  res.status(500).json({error: "Internal server error"});
});

httpServer.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${env.PORT}`);
});
