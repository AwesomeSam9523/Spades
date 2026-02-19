import { createHmac, timingSafeEqual } from "node:crypto";

type AuthTokenPayload = {
  sub: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  iat: number;
  exp: number;
};

type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

const encode = (value: object): string => {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
};

const decode = <T>(value: string): T => {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
};

const sign = (data: string, secret: string): string => {
  return createHmac("sha256", secret).update(data).digest("base64url");
};

export const createAuthToken = (user: AuthUser, secret: string, ttlSeconds: number): string => {
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthTokenPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    iat: now,
    exp: now + ttlSeconds
  };

  const header = encode({ alg: "HS256", typ: "JWT" });
  const body = encode(payload);
  const data = `${header}.${body}`;
  const signature = sign(data, secret);

  return `${data}.${signature}`;
};

export const verifyAuthToken = (token: string, secret: string): AuthUser => {
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) {
    throw new Error("Invalid token format");
  }

  const data = `${header}.${body}`;
  const expectedSignature = sign(data, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new Error("Invalid token signature");
  }

  const payload = decode<AuthTokenPayload>(body);
  if (
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("Invalid token payload");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new Error("Token expired");
  }

  return {
    id: payload.sub,
    email: payload.email,
    name: typeof payload.name === "string" ? payload.name : null,
    avatarUrl: typeof payload.avatarUrl === "string" ? payload.avatarUrl : null
  };
};
