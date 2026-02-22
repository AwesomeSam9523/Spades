import type { FriendsSnapshot, RoomSnapshot, SessionUser } from "../types/game";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const AUTH_TOKEN_STORAGE_KEY = "spades_auth_token";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

const getStoredAuthToken = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
};

export const getAuthToken = (): string | null => {
  hydrateAuthTokenFromUrlHash();
  return getStoredAuthToken();
};

const setStoredAuthToken = (token: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
};

const clearStoredAuthToken = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

const hydrateAuthTokenFromUrlHash = (): void => {
  if (typeof window === "undefined") {
    return;
  }

  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) {
    return;
  }

  const params = new URLSearchParams(hash);
  const token = params.get("auth_token");
  if (!token) {
    return;
  }

  setStoredAuthToken(token);
  window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
};

const request = async <T>(path: string, method: HttpMethod, body?: unknown): Promise<T> => {
  hydrateAuthTokenFromUrlHash();
  const authToken = getStoredAuthToken();

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
    },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    let message = "Request failed";

    try {
      const json = (await response.json()) as { error?: string };
      if (json.error) {
        message = json.error;
      }
    } catch {
      // ignore parsing error and use default message
    }

    if (response.status === 401) {
      clearStoredAuthToken();
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

export const getSessionUser = async (): Promise<SessionUser> => {
  const result = await request<{ user: SessionUser }>("/api/auth/me", "GET");
  return result.user;
};

export const createRoom = async (name: string): Promise<RoomSnapshot> => {
  return request<RoomSnapshot>("/api/rooms", "POST", { name });
};

export const joinRoomByCode = async (code: string): Promise<RoomSnapshot> => {
  return request<RoomSnapshot>("/api/rooms/join", "POST", { code });
};

export const getMyRooms = async (): Promise<
  {
    roomId: string;
    roomName: string;
    roomCode: string;
    joinedAt: string;
  }[]
> => {
  const result = await request<{
    rooms: {
      roomId: string;
      roomName: string;
      roomCode: string;
      joinedAt: string;
    }[];
  }>("/api/rooms/mine", "GET");

  return result.rooms;
};

export const getRoom = async (roomId: string): Promise<RoomSnapshot> => {
  return request<RoomSnapshot>(`/api/rooms/${roomId}`, "GET");
};

export const startRound = async (roomId: string): Promise<void> => {
  await request(`/api/rooms/${roomId}/rounds`, "POST");
};

export const lockOrUpdateCall = async (
  roundId: string,
  calledHands: number,
  lock: boolean,
  blindCall: boolean
): Promise<void> => {
  await request(`/api/rounds/${roundId}/call`, "PATCH", { calledHands, lock, blindCall });
};

export const reportWinningHands = async (roundId: string, winningHands: number): Promise<void> => {
  await request(`/api/rounds/${roundId}/report`, "PATCH", { winningHands });
};

export const startActiveRound = async (roundId: string): Promise<void> => {
  await request(`/api/rounds/${roundId}/start`, "POST");
};

export const endActiveRound = async (roundId: string): Promise<void> => {
  await request(`/api/rounds/${roundId}/end`, "POST");
};

export const verifyWinningHands = async (roundId: string, memberId: string, verifiedWinningHands: number): Promise<void> => {
  await request(`/api/rounds/${roundId}/verify/${memberId}`, "PATCH", { verifiedWinningHands });
};

export const closeRound = async (roundId: string): Promise<void> => {
  await request(`/api/rounds/${roundId}/close`, "POST");
};

export const kickMember = async (roomId: string, memberId: string): Promise<void> => {
  await request(`/api/rooms/${roomId}/members/${memberId}`, "DELETE");
};

export const makeLeader = async (roomId: string, memberId: string): Promise<void> => {
  await request(`/api/rooms/${roomId}/leader/${memberId}`, "PATCH");
};

export const getFriends = async (): Promise<FriendsSnapshot> => {
  return request<FriendsSnapshot>("/api/friends", "GET");
};

export const sendFriendRequest = async (email: string): Promise<void> => {
  await request("/api/friends/requests", "POST", { email });
};

export const respondToFriendRequest = async (requestId: string, action: "accept" | "decline"): Promise<void> => {
  await request(`/api/friends/requests/${requestId}`, "PATCH", { action });
};

export const joinFriendRoom = async (friendUserId: string): Promise<RoomSnapshot> => {
  return request<RoomSnapshot>(`/api/friends/${friendUserId}/join`, "POST");
};

export const logout = async (): Promise<void> => {
  await request<void>("/auth/logout", "POST");
  clearStoredAuthToken();
};

export const getGoogleLoginUrl = (): string => `${apiBaseUrl}/auth/google`;
export const getSocketUrl = (): string => apiBaseUrl;
