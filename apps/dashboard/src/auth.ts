import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { z } from 'zod'

const credentialsSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/',
  },
  providers: [
    Credentials({
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (credentials) => {
        const parsed = credentialsSchema.safeParse(credentials)
        if (!parsed.success) {
          return null
        }

        const expectedUsername = process.env.ADMIN_USERNAME
        const expectedPassword = process.env.ADMIN_PASSWORD

        if (!expectedUsername || !expectedPassword) {
          throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must be configured')
        }

        if (
          parsed.data.username !== expectedUsername ||
          parsed.data.password !== expectedPassword
        ) {
          return null
        }

        return {
          id: 'admin',
          name: parsed.data.username,
          email: 'admin@agentpod.local',
        }
      },
    }),
  ],
  callbacks: {
    authorized: ({ auth, request }) => {
      const isDashboardRoute = request.nextUrl.pathname.startsWith('/dashboard')
      if (!isDashboardRoute) {
        return true
      }
      return Boolean(auth?.user)
    },
  },
})
