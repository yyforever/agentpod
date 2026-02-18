import { redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { auth } from '@/auth'
import { loginAction } from '@/app/actions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>
}

function getErrorMessage(error?: string): string | null {
  if (!error) {
    return null
  }

  if (error === 'invalid_credentials') {
    return 'Invalid username or password.'
  }

  if (error === 'invalid_input') {
    return 'Please provide both username and password.'
  }

  return 'Login failed. Please try again.'
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth()
  if (session?.user) {
    redirect('/dashboard')
  }

  const params = await searchParams
  const errorMessage = getErrorMessage(params.error)

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <Card className="w-full max-w-md border-zinc-800 bg-zinc-900/80">
        <CardHeader>
          <CardTitle>AgentPod Admin</CardTitle>
          <CardDescription>Sign in to manage tenants and pods</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Authentication Error</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
          <form action={loginAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input id="username" name="username" autoComplete="username" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button className="w-full" type="submit">
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
