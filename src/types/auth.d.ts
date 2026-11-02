import type { DefaultSession } from "next-auth";
declare module "next-auth" {
  interface User { sessionVersion?: number }
  interface Session { user: { id: string } & DefaultSession["user"]; csrfToken?: string }
}
