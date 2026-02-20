"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createRoom, getGoogleLoginUrl, getMyRooms, getSessionUser, joinRoomByCode, logout } from "../lib/api";
import type { SessionUser } from "../types/game";

type MyRoom = {
  roomId: string;
  roomName: string;
  roomCode: string;
  joinedAt: string;
};

function Avatar({ name, src }: { name: string; src: string | null }) {
  if (src) {
    return <img className="avatar" src={src} alt={name} />;
  }

  return <span className="avatar avatar-fallback">{name.slice(0, 1).toUpperCase()}</span>;
}

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loadingAction, setLoadingAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("Weekend Spades");
  const [joinCode, setJoinCode] = useState("");
  const [rooms, setRooms] = useState<MyRoom[]>([]);

  const loginUrl = useMemo(() => getGoogleLoginUrl(), []);

  useEffect(() => {
    const initialize = async () => {
      try {
        const sessionUser = await getSessionUser();
        setUser(sessionUser);
        const myRooms = await getMyRooms();
        setRooms(myRooms);
      } catch {
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    };

    void initialize();
  }, []);

  const handleCreateRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoadingAction(true);
    setError(null);

    try {
      const snapshot = await createRoom(roomName);
      router.push(`/room/${snapshot.room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create room");
    } finally {
      setLoadingAction(false);
    }
  };

  const handleJoinRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoadingAction(true);
    setError(null);

    try {
      const snapshot = await joinRoomByCode(joinCode.trim().toUpperCase());
      router.push(`/room/${snapshot.room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to join room");
    } finally {
      setLoadingAction(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setRooms([]);
  };

  if (authLoading) {
    return (
      <main>
        <h1>Spades Room Tracker</h1>
        <p className="muted">Checking login session...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main>
        <h1>Spades Room Tracker</h1>
        <p className="muted">Sign in with Google to save room history and scores.</p>
        <div className="card">
          <a href={loginUrl}>
            <button type="button">Login with Google</button>
          </a>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className="spread">
        <div>
          <h1>Spades Room Tracker</h1>
        </div>
        <div className="top-actions">
          <div className="user-chip">
            <Avatar name={user.name ?? user.email} src={user.avatarUrl} />
            <span>{user.name ?? user.email}</span>
          </div>
          <button type="button" className="secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p style={{ color: "var(--warn)", margin: 0 }}>{error}</p>
        </div>
      ) : null}

      <section className="grid grid-2">
        <form className="card" onSubmit={handleCreateRoom}>
          <h2>Create Room</h2>
          <p className="muted">You become the room leader and verify hands at round end.</p>
          <label htmlFor="room-name">Room name</label>
          <input
            id="room-name"
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            maxLength={40}
            required
          />
          <div style={{ marginTop: 10 }}>
            <button disabled={loadingAction} type="submit">
              Create Room
            </button>
          </div>
        </form>

        <form className="card" onSubmit={handleJoinRoom}>
          <h2>Join With Code</h2>
          <p className="muted">Ask the room leader for the 6-character room code.</p>
          <label htmlFor="join-code">Room code</label>
          <input
            id="join-code"
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            maxLength={6}
            placeholder="ABC123"
            required
          />
          <div style={{ marginTop: 10 }}>
            <button disabled={loadingAction} type="submit">
              Join Room
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Your Rooms</h2>
        {rooms.length === 0 ? (
          <p className="muted">No rooms yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Joined</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => (
                  <tr key={room.roomId}>
                    <td>{room.roomName}</td>
                    <td>
                      <span className="code">{room.roomCode}</span>
                    </td>
                    <td>{new Date(room.joinedAt).toLocaleString()}</td>
                    <td>
                      <button type="button" onClick={() => router.push(`/room/${room.roomId}`)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
