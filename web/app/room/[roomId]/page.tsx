"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import {
  closeRound,
  endActiveRound,
  getRoom,
  getSessionUser,
  getSocketUrl,
  kickMember,
  lockOrUpdateCall,
  makeLeader,
  logout,
  reportWinningHands,
  startActiveRound,
  startRound,
  verifyWinningHands
} from "../../../lib/api";
import type { Round, RoomSnapshot, SessionUser } from "../../../types/game";

const getActiveRound = (rounds: Round[]): Round | undefined => {
  return [...rounds].reverse().find((round) => round.state === "IN_PROGRESS");
};

const ROOM_MAX_PLAYERS = 4;
const MIN_CALL_HANDS = 2;
const MIN_RESULT_HANDS = 0;
const MAX_HANDS = 13;
const BLIND_MIN_HANDS = 5;

const getSetRoundMeta = (roundNumber: number) => {
  const safeRound = Math.max(roundNumber, 1);
  return {
    setNumber: Math.floor((safeRound - 1) / 4) + 1,
    roundInSet: ((safeRound - 1) % 4) + 1
  };
};

type StepperProps = {
  value: number;
  onChange: (nextValue: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
};

function Stepper({ value, onChange, min = MIN_RESULT_HANDS, max = MAX_HANDS, disabled = false }: StepperProps) {
  return (
    <div className="row">
      <button
        type="button"
        className="secondary"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        -
      </button>
      <span className="code" style={{ minWidth: 44, textAlign: "center" }}>
        {value}
      </span>
      <button type="button" className="secondary" disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

function Avatar({ name, src, small = false }: { name: string; src: string | null; small?: boolean }) {
  const className = small ? "avatar small" : "avatar";

  if (src) {
    return <img className={className} src={src} alt={name} />;
  }

  return <span className={`${className} avatar-fallback`}>{name.slice(0, 1).toUpperCase()}</span>;
}

const formatHands = (value: number | null, blindCall: boolean) => {
  if (value == null) {
    return "-";
  }
  return `${blindCall ? "*" : ""}${value}`;
};

const formatDiff = (value: number) => {
  if (value > 0) {
    return `+${value}`;
  }
  return `${value}`;
};

export default function RoomPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const roomId = params.roomId;
  const socketRef = useRef<Socket | null>(null);
  const userIdRef = useRef<string | null>(null);

  const [user, setUser] = useState<SessionUser | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callValue, setCallValue] = useState<number>(MIN_CALL_HANDS);
  const [blindCall, setBlindCall] = useState(false);
  const [reportValue, setReportValue] = useState<number>(MIN_RESULT_HANDS);
  const [verifyValues, setVerifyValues] = useState<Record<string, number>>({});

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [sessionUser, roomSnapshot] = await Promise.all([getSessionUser(), getRoom(roomId)]);
        setUser(sessionUser);
        setSnapshot(roomSnapshot);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load room");
      } finally {
        setLoading(false);
      }
    };

    void bootstrap();
  }, [roomId]);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  useEffect(() => {
    const socket = io(getSocketUrl(), {
      withCredentials: true,
      transports: ["websocket"]
    });

    socket.on("connect", () => {
      socket.emit("room:subscribe", { roomId });
    });

    socket.on("room:update", (incoming: RoomSnapshot) => {
      if (incoming.room.id !== roomId) {
        return;
      }

      const currentUserId = userIdRef.current;
      if (currentUserId && !incoming.members.some((member) => member.userId === currentUserId)) {
        socket.emit("room:unsubscribe", { roomId });
        router.push("/");
        return;
      }

      setSnapshot(incoming);
    });

    socketRef.current = socket;

    return () => {
      socket.emit("room:unsubscribe", { roomId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, router]);

  const activeRound = useMemo(() => getActiveRound(snapshot?.rounds ?? []), [snapshot]);
  const isLeader = Boolean(user && snapshot && user.id === snapshot.room.leaderId);

  const myEntry = useMemo(() => {
    if (!activeRound || !user) {
      return null;
    }
    return activeRound.entries.find((entry) => entry.userId === user.id) ?? null;
  }, [activeRound, user]);

  const everyoneLocked = useMemo(() => {
    if (!activeRound) {
      return false;
    }
    return activeRound.entries.every((entry) => entry.locked);
  }, [activeRound]);

  const everyoneReported = useMemo(() => {
    if (!activeRound) {
      return false;
    }
    return activeRound.entries.every((entry) => entry.reportedWinningHands != null);
  }, [activeRound]);

  const everyoneVerified = useMemo(() => {
    if (!activeRound) {
      return false;
    }
    const reportableEntries = activeRound.entries.filter((entry) => entry.reportedWinningHands != null);
    if (reportableEntries.length === 0) {
      return false;
    }
    return reportableEntries.every((entry) => entry.verifiedWinningHands != null);
  }, [activeRound]);

  const reportedHandsTotal = useMemo(() => {
    if (!activeRound) {
      return null;
    }

    const reportedHands = activeRound.entries
      .map((entry) => entry.reportedWinningHands)
      .filter((value): value is number => value != null);

    if (reportedHands.length !== activeRound.entries.length) {
      return null;
    }

    return reportedHands.reduce((sum, value) => sum + value, 0);
  }, [activeRound]);

  const reportedSumIsThirteen = reportedHandsTotal === 13;

  useEffect(() => {
    if (!myEntry) {
      return;
    }

    setCallValue(Math.max(myEntry.calledHands, MIN_CALL_HANDS));
    setBlindCall(myEntry.blindCall);
    setReportValue(myEntry.reportedWinningHands ?? MIN_RESULT_HANDS);
  }, [myEntry?.entryId, myEntry?.calledHands, myEntry?.blindCall, myEntry?.reportedWinningHands]);

  useEffect(() => {
    if (!activeRound) {
      return;
    }

    const nextValues: Record<string, number> = {};
    for (const entry of activeRound.entries) {
      nextValues[entry.memberId] = entry.verifiedWinningHands ?? entry.reportedWinningHands ?? MIN_RESULT_HANDS;
    }
    setVerifyValues(nextValues);
  }, [activeRound]);

  const runAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/");
    } catch {
      setError("Unable to logout right now");
    }
  };

  if (loading) {
    return (
      <main>
        <p>Loading room...</p>
      </main>
    );
  }

  if (!snapshot || !user) {
    return (
      <main>
        <p style={{ color: "var(--warn)" }}>{error ?? "Room not found"}</p>
        <Link href="/">Back to home</Link>
      </main>
    );
  }

  const lastRoundNumber = snapshot.rounds.at(-1)?.roundNumber ?? 0;
  const nextRoundMeta = getSetRoundMeta(lastRoundNumber + 1);
  const activeRoundMeta = activeRound ? getSetRoundMeta(activeRound.roundNumber) : null;
  const isRoomFull = snapshot.members.length >= ROOM_MAX_PLAYERS;
  const myLeaderboardPoints = snapshot.leaderboard.find((member) => member.userId === user.id)?.totalPoints ?? 0;
  const verifyAllLabel = everyoneVerified ? "All Verified" : "Verify All";

  const verifyAll = async () => {
    if (!activeRound) {
      return;
    }

    const reportableEntries = activeRound.entries.filter((entry) => entry.reportedWinningHands != null);
    for (const entry of reportableEntries) {
      const winningHands = verifyValues[entry.memberId] ?? entry.reportedWinningHands ?? MIN_RESULT_HANDS;
      await verifyWinningHands(activeRound.id, entry.memberId, winningHands);
    }
  };

  return (
    <main>
      <div className="spread">
        <div>
          <h1>{snapshot.room.name}</h1>
          <p className="muted">
            Room code <span className="code">{snapshot.room.code}</span>
          </p>
        </div>
        <div className="top-actions">
          <div className="user-chip">
            <Avatar name={user.name ?? user.email} src={user.avatarUrl} />
            <span>{user.name ?? user.email}</span>
          </div>
          <Link href="/">
            <button type="button" className="secondary">
              Back
            </button>
          </Link>
          <button type="button" className="secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p style={{ margin: 0, color: "var(--warn)" }}>{error}</p>
        </div>
      ) : null}

      <section className="card">
        <div className="spread">
          <h2>
            Players ({snapshot.members.length}/{ROOM_MAX_PLAYERS})
          </h2>
          {isRoomFull ? <span className="status ok">Room full</span> : <span className="status">Open slots available</span>}
        </div>
        <div className={`table-wrap players-wrap${isLeader ? "" : " no-scroll"}`}>
          <table className="players-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                {isLeader ? <th>Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {snapshot.members.map((member) => (
                <tr key={member.memberId}>
                  <td>
                    <span className="table-name-truncate" title={member.displayName}>
                      {member.displayName}
                    </span>
                  </td>
                  <td>{member.isLeader ? "Leader" : "Player"}</td>
                  {isLeader ? (
                    <td>
                      {!member.isLeader ? (
                        <div className="row">
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() => runAction(() => makeLeader(snapshot.room.id, member.memberId))}
                          >
                            Make Leader
                          </button>
                          <button
                            type="button"
                            className="danger"
                            disabled={busy}
                            onClick={() => runAction(() => kickMember(snapshot.room.id, member.memberId))}
                          >
                            Kick
                          </button>
                        </div>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="spread">
          <h2>Round Controls</h2>
          {!activeRound ? (
            <span className="status">
              Next: Set {nextRoundMeta.setNumber}, Round {nextRoundMeta.roundInSet}/4
            </span>
          ) : (
            <span className="status">
              Set {activeRoundMeta?.setNumber}, Round {activeRoundMeta?.roundInSet}/4 ({activeRound.phase.toLowerCase()})
            </span>
          )}
        </div>

        {!activeRound && isLeader ? (
          <div style={{ marginTop: 10 }}>
            <button disabled={busy} type="button" onClick={() => runAction(() => startRound(snapshot.room.id))}>
              Start Set {nextRoundMeta.setNumber}, Round {nextRoundMeta.roundInSet}
            </button>
          </div>
        ) : null}

        {activeRound && isLeader && activeRound.phase === "CALLING" ? (
          <div className="row" style={{ marginTop: 10 }}>
            <button
              disabled={busy || !everyoneLocked}
              type="button"
              onClick={() => runAction(() => startActiveRound(activeRound.id))}
            >
              Start Round
            </button>
            {!everyoneLocked ? <span className="muted">Waiting for all players to lock calls.</span> : null}
          </div>
        ) : null}

        {activeRound && isLeader && activeRound.phase === "PLAYING" ? (
          <div className="row" style={{ marginTop: 10 }}>
            <button disabled={busy} type="button" className="danger" onClick={() => runAction(() => endActiveRound(activeRound.id))}>
              End Round
            </button>
            <span className="muted">After ending, players can report made hands.</span>
          </div>
        ) : null}

        {activeRound && myEntry && activeRound.phase === "CALLING" ? (
          <div style={{ marginTop: 12 }}>
            <h3>Your Call</h3>
            <p className="muted">Call range is 2-13. Blind call requires at least 5 and gives 2x positive points.</p>
              <Stepper
                value={callValue}
                min={myEntry.locked ? Math.max(myEntry.calledHands, MIN_CALL_HANDS) : MIN_CALL_HANDS}
                max={MAX_HANDS}
                disabled={busy}
                onChange={setCallValue}
              />
            <div className="row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className={blindCall ? "" : "secondary"}
                disabled={busy}
                onClick={() => {
                  const nextBlind = !blindCall;
                  setBlindCall(nextBlind);
                  if (nextBlind && callValue < BLIND_MIN_HANDS) {
                    setCallValue(BLIND_MIN_HANDS);
                  }
                }}
              >
                Blind Call {blindCall ? "On" : "Off"}
              </button>
              {!myEntry.locked ? (
                <button
                  disabled={busy || (blindCall && callValue < BLIND_MIN_HANDS)}
                  type="button"
                  onClick={() => runAction(() => lockOrUpdateCall(activeRound.id, callValue, true, blindCall))}
                >
                  Lock Call
                </button>
              ) : (
                <button
                  disabled={busy || (blindCall && callValue < BLIND_MIN_HANDS)}
                  type="button"
                  onClick={() => runAction(() => lockOrUpdateCall(activeRound.id, callValue, false, blindCall))}
                >
                  Update Call
                </button>
              )}
            </div>
            {blindCall && callValue < BLIND_MIN_HANDS ? (
              <p className="muted" style={{ marginTop: 6 }}>
                Blind call must be at least {BLIND_MIN_HANDS}.
              </p>
            ) : null}
            <p className="muted" style={{ marginTop: 6 }}>
              Current locked call: {formatHands(myEntry.calledHands, myEntry.blindCall)}
            </p>
          </div>
        ) : null}

        {activeRound && myEntry && activeRound.phase === "PLAYING" ? (
          <p className="muted" style={{ marginTop: 12 }}>
            Round in progress. Reporting unlocks after leader clicks End Round.
          </p>
        ) : null}

        {activeRound && myEntry && activeRound.phase === "ENDED" ? (
          <div style={{ marginTop: 12 }}>
            <h3>Report Winning Hands</h3>
            <p className="muted">Report range is 0-13.</p>
            <Stepper value={reportValue} min={MIN_RESULT_HANDS} max={MAX_HANDS} disabled={busy} onChange={setReportValue} />
            <div style={{ marginTop: 8 }}>
              <button disabled={busy} type="button" onClick={() => runAction(() => reportWinningHands(activeRound.id, reportValue))}>
                Submit Report
              </button>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              Your reported hands:{" "}
              <span className={reportedSumIsThirteen ? "sum-thirteen" : undefined}>
                {formatHands(myEntry.reportedWinningHands, myEntry.blindCall)}
              </span>
            </p>
          </div>
        ) : null}
      </section>

      {activeRound ? (
        <section className="card">
          <div className="spread">
            <h2>Leader Verification</h2>
            {isLeader && activeRound.phase === "ENDED" ? (
              <div className="row">
                <button
                  className={everyoneVerified ? "success" : "secondary"}
                  disabled={busy || !everyoneReported}
                  type="button"
                  onClick={() => runAction(verifyAll)}
                >
                  {verifyAllLabel}
                </button>
                <button disabled={busy || !everyoneReported} type="button" onClick={() => runAction(() => closeRound(activeRound.id))}>
                  Close Round and Score
                </button>
              </div>
            ) : null}
          </div>

          {activeRound.phase !== "ENDED" ? (
            <p className="muted">Verification becomes available only after End Round.</p>
          ) : null}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Called</th>
                  <th>Reported</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {activeRound.entries.map((entry) => (
                  <tr key={entry.entryId}>
                    <td>{entry.displayName}</td>
                    <td>{formatHands(entry.calledHands, entry.blindCall)}</td>
                    <td className={reportedSumIsThirteen ? "sum-thirteen" : undefined}>
                      {isLeader && activeRound.phase === "ENDED" && entry.verifiedWinningHands != null
                        ? formatHands(entry.verifiedWinningHands, entry.blindCall)
                        : formatHands(entry.reportedWinningHands, entry.blindCall)}
                    </td>
                    <td>
                      {isLeader && activeRound.phase === "ENDED" ? (
                        <div className="row">
                          <Stepper
                            value={verifyValues[entry.memberId] ?? MIN_RESULT_HANDS}
                            min={MIN_RESULT_HANDS}
                            max={MAX_HANDS}
                            disabled={busy}
                            onChange={(nextValue) =>
                              setVerifyValues((prev) => ({
                                ...prev,
                                [entry.memberId]: nextValue
                              }))
                            }
                          />
                          <button
                            className={entry.verifiedWinningHands != null ? "success" : "secondary"}
                            disabled={busy || entry.reportedWinningHands == null}
                            type="button"
                            onClick={() =>
                              runAction(() =>
                                verifyWinningHands(activeRound.id, entry.memberId, verifyValues[entry.memberId] ?? MIN_RESULT_HANDS)
                              )
                            }
                          >
                            {entry.verifiedWinningHands != null ? "Verified" : "Verify"}
                          </button>
                        </div>
                      ) : (
                        <span className="muted">Leader only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>Live Leaderboard</h2>
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Diff vs You</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.leaderboard.map((member) => {
              const diff = member.totalPoints - myLeaderboardPoints;
              const diffClass = diff > 0 ? "diff-positive" : diff < 0 ? "diff-negative" : "diff-neutral";

              return (
                <tr key={member.memberId}>
                  <td>
                    <div className="player-cell">
                      <Avatar name={member.displayName} src={member.avatarUrl} small />
                      <span className="player-name" title={member.displayName}>
                        {member.displayName}
                      </span>
                    </div>
                  </td>
                  <td className={diffClass}>{formatDiff(diff)}</td>
                  <td>{member.totalPoints}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
