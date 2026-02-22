"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client";
import {
  createRoom,
  getAuthToken,
  getFriends,
  getGoogleLoginUrl,
  getMyRooms,
  getSessionUser,
  getSocketUrl,
  joinFriendRoom,
  joinRoomByCode,
  logout,
  respondToFriendRequest,
  sendFriendRequest
} from "../lib/api";
import type { FriendsSnapshot, SessionUser } from "../types/game";

type MyRoom = {
  roomId: string;
  roomName: string;
  roomCode: string;
  joinedAt: string;
};

const emptyFriendsSnapshot: FriendsSnapshot = {
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  suggestions: []
};

function Avatar({ name, src }: { name: string; src: string | null }) {
  if (src) {
    return <img className="avatar" src={src} alt={name} />;
  }

  return <span className="avatar avatar-fallback">{name.slice(0, 1).toUpperCase()}</span>;
}

function OnlineStatus({ online }: { online: boolean }) {
  return (
    <span className={online ? "status ok" : "status"}>
      {online ? "Online" : "Offline"}
    </span>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loadingAction, setLoadingAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("Weekend Spades");
  const [joinCode, setJoinCode] = useState("");
  const [friendEmail, setFriendEmail] = useState("");
  const [rooms, setRooms] = useState<MyRoom[]>([]);
  const [friendsSnapshot, setFriendsSnapshot] = useState<FriendsSnapshot>(emptyFriendsSnapshot);

  const loginUrl = useMemo(() => getGoogleLoginUrl(), []);

  useEffect(() => {
    const initialize = async () => {
      try {
        const sessionUser = await getSessionUser();
        setUser(sessionUser);
        const [myRooms, myFriends] = await Promise.all([getMyRooms(), getFriends()]);
        setRooms(myRooms);
        setFriendsSnapshot(myFriends);
      } catch {
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    };

    void initialize();
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    const token = getAuthToken();
    const socket = io(getSocketUrl(), {
      withCredentials: true,
      transports: ["websocket"],
      auth: token ? { token } : undefined
    });

    socket.on("friends:update", async () => {
      try {
        const latestSnapshot = await getFriends();
        setFriendsSnapshot(latestSnapshot);
      } catch {
        // ignore transient network or auth errors in passive refresh
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [user?.id]);

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

  const handleSendFriendRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoadingAction(true);
    setError(null);

    try {
      await sendFriendRequest(friendEmail.trim().toLowerCase());
      setFriendEmail("");
      const latestSnapshot = await getFriends();
      setFriendsSnapshot(latestSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send friend request");
    } finally {
      setLoadingAction(false);
    }
  };

  const handleSuggestionFriendRequest = async (email: string) => {
    setLoadingAction(true);
    setError(null);

    try {
      await sendFriendRequest(email.trim().toLowerCase());
      const latestSnapshot = await getFriends();
      setFriendsSnapshot(latestSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send friend request");
    } finally {
      setLoadingAction(false);
    }
  };

  const handleFriendRequestAction = async (requestId: string, action: "accept" | "decline") => {
    setLoadingAction(true);
    setError(null);

    try {
      await respondToFriendRequest(requestId, action);
      const [myFriends, myRooms] = await Promise.all([getFriends(), getMyRooms()]);
      setFriendsSnapshot(myFriends);
      setRooms(myRooms);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update friend request");
    } finally {
      setLoadingAction(false);
    }
  };

  const handleJoinFriendRoom = async (friendUserId: string) => {
    setLoadingAction(true);
    setError(null);

    try {
      const snapshot = await joinFriendRoom(friendUserId);
      router.push(`/room/${snapshot.room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to join your friend's room");
    } finally {
      setLoadingAction(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setRooms([]);
    setFriendsSnapshot(emptyFriendsSnapshot);
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

      <section className="card">
        <h2>Friends</h2>
        <div style={{ marginTop: 12 }}>
          <h3>Friend Requests</h3>
          <form onSubmit={handleSendFriendRequest}>
            <label htmlFor="friend-email">Add by email</label>
            <input
              id="friend-email"
              value={friendEmail}
              onChange={(event) => setFriendEmail(event.target.value)}
              placeholder="friend@gmail.com"
              type="email"
              required
            />
            <div style={{ marginTop: 10 }}>
              <button disabled={loadingAction} type="submit">
                Send Request
              </button>
            </div>
          </form>

          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div>
              <h3>Incoming</h3>
              {friendsSnapshot.incomingRequests.length === 0 ? (
                <p className="muted">No incoming requests.</p>
              ) : (
                <div className="stack">
                  {friendsSnapshot.incomingRequests.map((request) => (
                    <div key={request.requestId} className="friend-request-row">
                      <div className="player-cell">
                        <Avatar name={request.from.displayName} src={request.from.avatarUrl} />
                        <div>
                          <div>{request.from.displayName}</div>
                          <div className="muted">{request.from.email}</div>
                        </div>
                      </div>
                      <div className="row">
                        <button disabled={loadingAction} type="button" onClick={() => handleFriendRequestAction(request.requestId, "accept")}>
                          Accept
                        </button>
                        <button
                          disabled={loadingAction}
                          type="button"
                          className="secondary"
                          onClick={() => handleFriendRequestAction(request.requestId, "decline")}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3>Outgoing</h3>
              {friendsSnapshot.outgoingRequests.length === 0 ? (
                <p className="muted">No outgoing requests.</p>
              ) : (
                <div className="stack">
                  {friendsSnapshot.outgoingRequests.map((request) => (
                    <div key={request.requestId} className="friend-request-row">
                      <div className="player-cell">
                        <Avatar name={request.to.displayName} src={request.to.avatarUrl} />
                        <div>
                          <div>{request.to.displayName}</div>
                          <div className="muted">{request.to.email}</div>
                        </div>
                      </div>
                      <span className="status">Pending</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <h3>Friends</h3>
          {friendsSnapshot.friends.length === 0 ? (
            <p className="muted">No friends yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Friend</th>
                    <th>Status</th>
                    <th>Room</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {friendsSnapshot.friends.map((friend) => (
                    <tr key={friend.userId}>
                      <td>
                        <div className="player-cell">
                          <Avatar name={friend.displayName} src={friend.avatarUrl} />
                          <span className="table-name-truncate" title={friend.displayName}>
                            {friend.displayName}
                          </span>
                        </div>
                      </td>
                      <td>
                        <OnlineStatus online={friend.isOnline} />
                      </td>
                      <td>
                        {friend.room ? (
                          <div>
                            <div className="table-name-truncate" title={friend.room.roomName}>
                              {friend.room.roomName}
                            </div>
                            <span className="code">{friend.room.roomCode}</span>
                            {friend.room.hasActiveRound ? <div className="muted">Round in progress</div> : null}
                          </div>
                        ) : (
                          <span className="muted">No room</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          disabled={loadingAction || !friend.room || !friend.room.canJoin}
                          onClick={() => handleJoinFriendRoom(friend.userId)}
                        >
                          Join Room
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ marginTop: 20 }}>
          <h3>Friend Suggestions</h3>
          {friendsSnapshot.suggestions.length === 0 ? (
            <p className="muted">No suggestions yet. Play more rounds to discover people.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Status</th>
                    <th>Last Played</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {friendsSnapshot.suggestions.map((suggestion) => (
                    <tr key={suggestion.userId}>
                      <td>
                        <div className="player-cell">
                          <Avatar name={suggestion.displayName} src={suggestion.avatarUrl} />
                          <div>
                            <div className="table-name-truncate" title={suggestion.displayName}>
                              {suggestion.displayName}
                            </div>
                            <div className="muted">{suggestion.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <OnlineStatus online={suggestion.isOnline} />
                      </td>
                      <td>{new Date(suggestion.lastPlayedAt).toLocaleString()}</td>
                      <td>
                        <button
                          type="button"
                          disabled={loadingAction}
                          onClick={() => handleSuggestionFriendRequest(suggestion.email)}
                        >
                          Send Request
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
