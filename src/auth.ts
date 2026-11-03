import NextAuth, { getServerSession, type NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { loginAdministrator } from "@/lib/admin-login";
import { csrfForNonce } from "@/lib/auth-policy";
import { revokeOnSignOut } from "@/lib/security-store";
import { z } from "zod";

const input = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(1024), code: z.string().min(1).max(128), recovery: z.string().optional() });
// AUTH_URL is our single canonical origin; map it to the stable provider's name.
if (process.env.AUTH_URL) process.env.NEXTAUTH_URL = process.env.AUTH_URL;
export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  pages: { signIn: "/login" }, session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  providers: [Credentials({
    credentials: { username: {}, password: {}, code: {}, recovery: {} },
    async authorize(credentials) {
      const parsed = input.safeParse(credentials); if (!parsed.success || !process.env.AUTH_SECRET || !process.env.TOTP_ENCRYPTION_KEY) return null;
      const data = parsed.data;
      try {
        return await loginAdministrator({ ...data, recovery: data.recovery === "true" });
      } catch { return null; }
    },
  })],
  events: { async signOut({ token }) { if (token?.adminId && typeof token.sessionVersion === "number" && process.env.DATABASE_URL) await revokeOnSignOut(String(token.adminId), token.sessionVersion); } },
  callbacks: {
    async jwt({ token, user }) { if (user) { token.adminId = user.id; token.sessionVersion = user.sessionVersion; token.csrfNonce = user.csrfNonce || randomUUID(); } return token; },
    async session({ session, token }) {
      if (!token.adminId || !process.env.AUTH_SECRET || !process.env.DATABASE_URL) return { ...session, user: undefined! };
      const admin = await db().adminUser.findUnique({ where: { id: String(token.adminId) } });
      if (!admin || !admin.mfaEnabled || admin.sessionVersion !== token.sessionVersion) return { ...session, user: undefined! };
      session.user.id = admin.id; session.sessionVersion = admin.sessionVersion; session.csrfToken = csrfForNonce(String(token.csrfNonce)); return session;
    },
  },
};
const handler = NextAuth(authOptions);
export const handlers = { GET: handler, POST: handler };
export const auth = () => getServerSession(authOptions);
