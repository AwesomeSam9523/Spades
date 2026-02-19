import type { User } from "@prisma/client";

declare global {
  namespace Express {
    interface User {
      id: User["id"];
      email: User["email"];
      name: User["name"];
      avatarUrl: User["avatarUrl"];
    }
  }
}

export {};
