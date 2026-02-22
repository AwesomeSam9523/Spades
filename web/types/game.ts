export type Member = {
  memberId: string;
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  totalPoints: number;
  isLeader: boolean;
};

export type RoundEntry = {
  entryId: string;
  memberId: string;
  userId: string;
  displayName: string;
  calledHands: number;
  blindCall: boolean;
  locked: boolean;
  reportedWinningHands: number | null;
  verifiedWinningHands: number | null;
  verifiedById: string | null;
  pointsAwarded: number | null;
};

export type Round = {
  id: string;
  roundNumber: number;
  state: "IN_PROGRESS" | "CLOSED";
  phase: "CALLING" | "PLAYING" | "ENDED";
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  closedAt: string | null;
  entries: RoundEntry[];
};

export type RoomSnapshot = {
  room: {
    id: string;
    code: string;
    name: string;
    status: "LOBBY" | "IN_PROGRESS" | "FINISHED";
    leaderId: string;
    createdAt: string;
  };
  members: Member[];
  rounds: Round[];
  leaderboard: Member[];
};

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

export type FriendRoom = {
  roomId: string;
  roomName: string;
  roomCode: string;
  hasActiveRound: boolean;
  canJoin: boolean;
};

export type Friend = {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  isOnline: boolean;
  room: FriendRoom | null;
};

export type IncomingFriendRequest = {
  requestId: string;
  createdAt: string;
  from: {
    userId: string;
    displayName: string;
    email: string;
    avatarUrl: string | null;
  };
};

export type OutgoingFriendRequest = {
  requestId: string;
  createdAt: string;
  to: {
    userId: string;
    displayName: string;
    email: string;
    avatarUrl: string | null;
  };
};

export type FriendsSnapshot = {
  friends: Friend[];
  incomingRequests: IncomingFriendRequest[];
  outgoingRequests: OutgoingFriendRequest[];
};
