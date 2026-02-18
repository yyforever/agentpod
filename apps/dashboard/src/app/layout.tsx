import type { Metadata } from 'next'
import Link from 'next/link'
import { Geist, Geist_Mono } from 'next/font/google'
import { Boxes, LayoutDashboard, Settings, Users, Wrench } from 'lucide-react'
import { logoutAction } from '@/app/actions'
import { auth } from '@/auth'
import { SidebarNav, type NavItem } from '@/components/dashboard/sidebar-nav'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'AgentPod Dashboard',
  description: 'Manage AgentPod tenants and pods',
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/pods', label: 'Pods' },
  { href: '/dashboard/adapters', label: 'Adapters' },
  { href: '/dashboard/settings', label: 'Settings' },
  { href: '/dashboard/tenants', label: 'Tenants' },
]

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await auth()
  const isAuthenticated = Boolean(session?.user)
  const displayName = session?.user?.name ?? session?.user?.email ?? 'admin'

  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-background text-foreground antialiased`}
      >
        {isAuthenticated ? (
          <div className="min-h-screen bg-zinc-950 text-zinc-100">
            <div className="flex min-h-screen">
              <aside className="hidden w-64 border-r border-zinc-800 bg-zinc-900/80 p-4 md:flex md:flex-col">
                <Link
                  href="/dashboard"
                  className="mb-6 inline-flex items-center gap-2 text-lg font-semibold"
                >
                  <Boxes className="size-5" />
                  AgentPod
                </Link>
                <SidebarNav items={navItems} />
              </aside>

              <div className="flex-1">
                <header className="flex h-16 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4 md:px-6">
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <LayoutDashboard className="size-4" />
                    Control Dashboard
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="hidden text-sm text-zinc-300 sm:block">{displayName}</span>
                    <form action={logoutAction}>
                      <Button variant="outline" size="sm" className="border-zinc-700 bg-zinc-900">
                        Logout
                      </Button>
                    </form>
                  </div>
                </header>

                <main className="space-y-6 p-4 md:p-6">{children}</main>
              </div>
            </div>

            <nav className="fixed inset-x-0 bottom-0 border-t border-zinc-800 bg-zinc-900/95 p-2 md:hidden">
              <div className="grid grid-cols-5 gap-1 text-xs">
                <Link
                  href="/dashboard"
                  className="flex flex-col items-center gap-1 rounded p-2 text-zinc-300"
                >
                  <LayoutDashboard className="size-4" />
                  Home
                </Link>
                <Link
                  href="/dashboard/pods"
                  className="flex flex-col items-center gap-1 rounded p-2 text-zinc-300"
                >
                  <Boxes className="size-4" />
                  Pods
                </Link>
                <Link
                  href="/dashboard/adapters"
                  className="flex flex-col items-center gap-1 rounded p-2 text-zinc-300"
                >
                  <Wrench className="size-4" />
                  Adapters
                </Link>
                <Link
                  href="/dashboard/settings"
                  className="flex flex-col items-center gap-1 rounded p-2 text-zinc-300"
                >
                  <Settings className="size-4" />
                  Settings
                </Link>
                <Link
                  href="/dashboard/tenants"
                  className="flex flex-col items-center gap-1 rounded p-2 text-zinc-300"
                >
                  <Users className="size-4" />
                  Tenants
                </Link>
              </div>
            </nav>
          </div>
        ) : (
          children
        )}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
