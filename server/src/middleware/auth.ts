import type { Request, Response, NextFunction } from "express";
import { verifyAuthToken } from "../utils/authToken.js";

const getTokenFromRequest = (req: Request): string | null => {
  const cookieToken = typeof req.cookies?.auth_token === "string" ? req.cookies.auth_token : null;
  if (cookieToken) {
    return cookieToken;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme === "Bearer" && token) {
    return token;
  }

  return null;
};

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    res.status(500).json({ error: "Server auth is not configured" });
    return;
  }

  const token = getTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    req.user = verifyAuthToken(token, jwtSecret);
  } catch {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  next();
};
