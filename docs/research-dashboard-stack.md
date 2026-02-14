# AgentPod Admin Dashboard 技术栈研究

> 研究日期：2026-02-15
> 目标：为 AgentPod 管理后台选定最优 Next.js Dashboard 技术栈

---

## 目录

1. [shadcn/ui Dashboard 模板评估](#1-shadcnui-dashboard-模板评估)
2. [NextAuth v5 单管理员认证方案](#2-nextauth-v5-单管理员认证方案)
3. [Server Components + Route Handlers BFF 模式](#3-server-components--route-handlers-bff-模式)
4. [实时状态推送方案对比](#4-实时状态推送方案对比)
5. [推荐技术栈组合](#5-推荐技术栈组合)

---

## 1. shadcn/ui Dashboard 模板评估

### 1.1 候选模板对比

| 模板 | 框架 | Stars | 最后更新 | 路由 | 认证 | 价格 |
|------|------|-------|----------|------|------|------|
| **Vercel Next.js + shadcn/ui** | Next.js 16 (App Router) | N/A (Vercel 官方) | 2025 活跃 | App Router | 内置 Postgres Auth | 免费 |
| **next-shadcn-dashboard-starter** (Kiranism) | Next.js 16 (App Router) | 3k+ | 2025 活跃 | App Router | Clerk | 免费 |
| **shadcn-admin** (satnaing) | Vite + React Router | 4k+ | 2025 活跃 | React Router | 自带 Auth UI | 免费 |
| **shadcnblocks Admin** | Next.js 15, React 19 | N/A | 月度更新 | App Router | 自带 | $129 |

### 1.2 各模板详细分析

#### Vercel 官方 Next.js + shadcn/ui Admin Dashboard

- **技术栈**: Next.js 16 + TypeScript + Tailwind CSS v4 + shadcn/ui
- **架构特点**: **Colocation-first**，每个 feature 把 pages、components、logic 放在自己的路由文件夹下，共享 UI/hooks/config 放顶层
- **内置功能**: Postgres 数据库、Auth 认证、主题切换、布局控制
- **优势**: Vercel 官方维护，与 Next.js 最新版本同步，架构现代、模块化
- **劣势**: 功能偏简洁，需要自行补充 data table、charts 等复杂组件

#### next-shadcn-dashboard-starter (Kiranism)

- **技术栈**: Next.js 16 + React 19 + shadcn/ui + TypeScript + Tailwind CSS
- **预构建页面**: 用户管理、分析、设置、数据可视化
- **核心组件**:
  - 高级 Data Table（排序、过滤、分页）
  - 表单组件（含验证）
  - Kanban 看板（dnd-kit + zustand）
  - 可定制图表
  - 6+ 主题支持
- **认证**: 集成 Clerk
- **文件结构**: Feature-based 目录组织
- **优势**: 组件最丰富，开箱即用程度高，Server Components 最佳实践
- **劣势**: 深度绑定 Clerk，需要替换为 Auth.js

#### shadcn-admin (satnaing)

- **技术栈**: Vite + React + TypeScript + shadcn/ui + React Router
- **核心功能**:
  - 10+ 预构建页面
  - 侧边栏导航（多团队、用户信息）
  - 全局搜索命令面板 (Command Palette)
  - Data Table 分页（带页码导航）
  - 暗色/亮色主题
  - RTL 语言支持
  - 完整 Auth 流程（登录、注册、退出）
- **优势**: Star 最多、社区最活跃、组件成熟
- **劣势**: **基于 Vite + React Router，不是 Next.js**，无法利用 Server Components、Route Handlers 等 Next.js 特性

#### shadcnblocks Admin Dashboard

- **技术栈**: Next.js 15 + React 19 + shadcn/ui + Tailwind 4
- **核心功能**: 几十个页面、复杂 Data Table、高级过滤、分页、图表、Context Menu
- **更新频率**: 月度更新
- **优势**: 功能最完整，商业级品质
- **劣势**: 付费 $129，非开源

### 1.3 模板选择结论

**推荐方案: 以 Vercel 官方模板为基础 + 从 next-shadcn-dashboard-starter 借鉴组件**

理由：
1. Vercel 官方模板的 colocation-first 架构最适合长期维护
2. Next.js 16 App Router + Server Components 原生支持
3. 内置 Postgres + Auth，可快速替换为 Auth.js v5
4. 从 Kiranism 的 starter 中提取 Data Table、Charts、Forms 等成熟组件
5. shadcn-admin (satnaing) 基于 Vite，架构不匹配，排除

**不推荐 shadcn-admin (satnaing)**：虽然 Star 最多，但基于 Vite + React Router，与我们需要的 Next.js Server Components + BFF 模式不兼容。

---

## 2. NextAuth v5 单管理员认证方案

### 2.1 方案概述

AgentPod 管理后台为**单管理员场景** -- 只有一个 admin 用户，无需注册流程。最简方案是使用 Auth.js v5（NextAuth v5）的 Credentials Provider，将管理员凭据存储在环境变量中。

### 2.2 核心配置

#### 环境变量

```env
# .env.local
AUTH_SECRET="openssl rand -base64 32 生成的随机字符串"
ADMIN_EMAIL="admin@agentpod.local"
ADMIN_PASSWORD_HASH="$2b$10$..."  # bcrypt 哈希后的密码
```

生成密码哈希：

```bash
# 使用 Node.js 生成 bcrypt hash
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('your-password', 10).then(h => console.log(h))"
```

#### auth.ts 配置

```typescript
// src/lib/auth.ts
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { compare } from 'bcryptjs'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) return null

        const { email, password } = parsed.data

        // 单管理员：直接对比环境变量
        if (email !== process.env.ADMIN_EMAIL) return null

        const passwordHash = process.env.ADMIN_PASSWORD_HASH
        if (!passwordHash) return null

        const isValid = await compare(password, passwordHash)
        if (!isValid) return null

        return {
          id: '1',
          email: process.env.ADMIN_EMAIL,
          name: 'Admin',
          role: 'admin',
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt', // Credentials Provider 必须使用 JWT
    maxAge: 24 * 60 * 60, // 24 小时过期
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        return { ...token, role: 'admin' }
      }
      return token
    },
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          role: token.role as string,
        },
      }
    },
  },
})
```

#### Route Handlers

```typescript
// src/app/api/auth/[...nextauth]/route.ts
import { handlers } from '@/lib/auth'

export const { GET, POST } = handlers
```

### 2.3 路由保护

#### 方式一：proxy.ts（Next.js 16）/ middleware.ts（Next.js 15）

> **注意**: Next.js 16 将 `middleware.ts` 重命名为 `proxy.ts`，导出函数名从 `middleware` 改为 `proxy`。运行时固定为 Node.js，不再支持 Edge Runtime。

```typescript
// src/proxy.ts (Next.js 16) 或 src/middleware.ts (Next.js 15)
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

// Next.js 16 用 proxy，Next.js 15 用 middleware
export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth

  // 公开路由白名单
  const publicPaths = ['/login', '/api/auth']
  const isPublicPath = publicPaths.some((path) =>
    req.nextUrl.pathname.startsWith(path)
  )

  if (!isLoggedIn && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (isLoggedIn && req.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    /*
     * 匹配所有路径，排除:
     * - _next/static (静态文件)
     * - _next/image (图片优化)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
```

#### 方式二：Server Component 层级保护（推荐与 proxy.ts 配合使用）

```typescript
// src/app/dashboard/layout.tsx
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  return <>{children}</>
}
```

> **安全最佳实践**: 不要仅依赖 proxy.ts/middleware.ts 做认证检查（参考 CVE-2025-29927）。始终在数据访问层（Server Component / Route Handler）做二次验证。

### 2.4 登录页面

```typescript
// src/app/login/page.tsx
'use client'

import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)

    const result = await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirect: false,
    })

    setLoading(false)

    if (result?.error) {
      setError('邮箱或密码错误')
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>AgentPod Admin</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="admin@agentpod.local"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '登录中...' : '登录'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

### 2.5 为何选择 Credentials Provider 而非 OAuth

| 维度 | Credentials Provider | OAuth (GitHub/Google) |
|------|---------------------|----------------------|
| 适用场景 | 单管理员、自托管 | 多用户、SaaS |
| 依赖 | 无外部依赖 | 依赖 OAuth 提供商 |
| 离线可用 | 是 | 否 |
| 配置复杂度 | 低 | 中（需注册 OAuth App） |
| 安全性 | bcrypt + JWT，够用 | OAuth 标准流程 |
| 数据库 | 不需要 | 通常需要 |

**结论**: 对于 AgentPod 的单管理员场景，Credentials Provider 是最简方案。无外部依赖、无数据库需求、离线可用。

---

## 3. Server Components + Route Handlers BFF 模式

### 3.1 架构设计

AgentPod Dashboard 需要与后端 Control Plane API 通信。使用 Next.js Route Handlers 作为 BFF（Backend For Frontend）代理层，实现：

```
浏览器 (Client Components)
  │
  ├─ Server Components ──→ 直接调用 Control Plane API（SSR 阶段）
  │
  └─ Client Components ──→ Next.js Route Handlers ──→ Control Plane API
                            (BFF 代理层)
```

### 3.2 类型安全的 API Client

```typescript
// src/lib/api/client.ts
import { auth } from '@/lib/auth'

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_API_URL!

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

interface RequestConfig {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.CONTROL_PLANE_API_KEY}`,
  }
}

export async function apiClient<T>(
  path: string,
  config: RequestConfig = {}
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, headers: extraHeaders = {} } = config

  try {
    const authHeaders = await getAuthHeaders()

    const response = await fetch(`${CONTROL_PLANE_URL}${path}`, {
      method,
      headers: { ...authHeaders, ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      return {
        success: false,
        error: errorData?.message ?? `API Error: ${response.status}`,
      }
    }

    const data = await response.json()
    return { success: true, data: data as T }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}
```

### 3.3 类型定义

```typescript
// src/lib/api/types.ts
export interface Container {
  id: string
  name: string
  status: 'running' | 'stopped' | 'creating' | 'error'
  image: string
  createdAt: string
  cpuUsage: number
  memoryUsage: number
}

export interface ContainerListResponse {
  containers: Container[]
  total: number
}

export interface CreateContainerRequest {
  name: string
  image: string
  env?: Record<string, string>
  resources?: {
    cpuLimit: string
    memoryLimit: string
  }
}
```

### 3.4 Route Handler 作为 BFF 代理

#### 通用 Catch-All 代理（简单场景）

```typescript
// src/app/api/proxy/[...path]/route.ts
import { auth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_API_URL!

async function proxyRequest(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { path } = await params
  const targetPath = path.join('/')
  const url = new URL(req.url)
  const targetUrl = `${CONTROL_PLANE_URL}/${targetPath}${url.search}`

  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  headers.set('Authorization', `Bearer ${process.env.CONTROL_PLANE_API_KEY}`)

  const body = req.method !== 'GET' ? await req.text() : undefined

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    })

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to reach Control Plane API' },
      { status: 502 }
    )
  }
}

export const GET = proxyRequest
export const POST = proxyRequest
export const PUT = proxyRequest
export const DELETE = proxyRequest
export const PATCH = proxyRequest
```

#### 独立 Route Handler（推荐，类型安全）

```typescript
// src/app/api/containers/route.ts
import { auth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { apiClient } from '@/lib/api/client'
import type { ContainerListResponse, CreateContainerRequest } from '@/lib/api/types'
import { z } from 'zod'

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await apiClient<ContainerListResponse>('/v1/containers')

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json(result.data)
}

const createContainerSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-z0-9-]+$/),
  image: z.string().min(1),
  env: z.record(z.string()).optional(),
  resources: z
    .object({
      cpuLimit: z.string(),
      memoryLimit: z.string(),
    })
    .optional(),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = createContainerSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const result = await apiClient<{ id: string }>('/v1/containers', {
    method: 'POST',
    body: parsed.data,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json(result.data, { status: 201 })
}
```

### 3.5 Server Components 数据获取

```typescript
// src/app/dashboard/containers/page.tsx
import { Suspense } from 'react'
import { apiClient } from '@/lib/api/client'
import type { ContainerListResponse } from '@/lib/api/types'
import { ContainerTable } from './container-table'
import { ContainerTableSkeleton } from './container-table-skeleton'

export default function ContainersPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Containers</h1>
      <Suspense fallback={<ContainerTableSkeleton />}>
        <ContainerList />
      </Suspense>
    </div>
  )
}

async function ContainerList() {
  const result = await apiClient<ContainerListResponse>('/v1/containers')

  if (!result.success) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-destructive">
        Failed to load containers: {result.error}
      </div>
    )
  }

  return <ContainerTable containers={result.data!.containers} />
}
```

### 3.6 错误处理模式

#### error.tsx -- 路由级错误边界

```typescript
// src/app/dashboard/containers/error.tsx
'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function ContainersError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // 上报错误到监控系统（如 Sentry）
    console.error('Container page error:', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12">
      <h2 className="text-xl font-semibold">出现错误</h2>
      <p className="text-muted-foreground">
        无法加载容器列表，请稍后重试
      </p>
      <Button onClick={reset}>重试</Button>
    </div>
  )
}
```

#### Promise.allSettled 并行请求

```typescript
// 多个独立 API 调用：用 Promise.allSettled 而非 Promise.all
async function DashboardOverview() {
  const [containersResult, metricsResult, alertsResult] =
    await Promise.allSettled([
      apiClient<ContainerListResponse>('/v1/containers'),
      apiClient<MetricsResponse>('/v1/metrics'),
      apiClient<AlertsResponse>('/v1/alerts'),
    ])

  const containers =
    containersResult.status === 'fulfilled' && containersResult.value.success
      ? containersResult.value.data
      : null

  const metrics =
    metricsResult.status === 'fulfilled' && metricsResult.value.success
      ? metricsResult.value.data
      : null

  const alerts =
    alertsResult.status === 'fulfilled' && alertsResult.value.success
      ? alertsResult.value.data
      : null

  return (
    <>
      {containers ? (
        <ContainerStats data={containers} />
      ) : (
        <ErrorCard message="无法加载容器信息" />
      )}
      {metrics ? (
        <MetricsChart data={metrics} />
      ) : (
        <ErrorCard message="无法加载监控数据" />
      )}
      {alerts ? (
        <AlertsList data={alerts} />
      ) : (
        <ErrorCard message="无法加载告警信息" />
      )}
    </>
  )
}
```

---

## 4. 实时状态推送方案对比

### 4.1 WebSocket vs SSE 对比

| 维度 | WebSocket | SSE (Server-Sent Events) |
|------|-----------|--------------------------|
| 通信方向 | 双向（全双工） | 单向（服务端推客户端） |
| 协议 | ws:// / wss:// | 标准 HTTP/HTTPS |
| 自动重连 | 需手动实现 | **浏览器原生支持** |
| 浏览器支持 | 全部主流浏览器 | 全部主流浏览器 |
| HTTP/2 兼容 | 不兼容 | **完全兼容，可多路复用** |
| 服务端实现 | 需专用 WebSocket 服务器 | 标准 HTTP 服务器即可 |
| Vercel 部署 | **不支持**（Serverless 限制） | **支持** |
| 负载均衡 | 需要 sticky session | 标准 HTTP LB 即可 |
| 延迟 | 最低 (~50ms) | 略高 (~100ms) |
| 适用场景 | 聊天、游戏、协作编辑 | **监控面板、通知、状态更新** |

### 4.2 推荐方案：SSE (Server-Sent Events)

**对于 AgentPod 的容器状态监控场景，SSE 是最优选择**，原因：

1. **单向推送足够**: 容器状态变更由服务端推送，客户端无需实时上行数据
2. **基础设施简单**: 无需 WebSocket 服务器，Route Handler 即可实现
3. **自动重连**: 浏览器 EventSource API 原生支持断线重连
4. **HTTP/2 兼容**: 多个 SSE 连接可复用同一 TCP 连接
5. **部署友好**: 无论自托管还是 Vercel 均可工作

### 4.3 SSE 服务端实现

```typescript
// src/app/api/events/containers/route.ts
import { auth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      // 发送初始连接确认
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)
      )

      // 轮询 Control Plane API 获取状态变更
      const intervalId = setInterval(async () => {
        try {
          const response = await fetch(
            `${process.env.CONTROL_PLANE_API_URL}/v1/containers/status`,
            {
              headers: {
                Authorization: `Bearer ${process.env.CONTROL_PLANE_API_KEY}`,
              },
            }
          )

          if (response.ok) {
            const data = await response.json()
            controller.enqueue(
              encoder.encode(
                `event: container-status\ndata: ${JSON.stringify(data)}\n\n`
              )
            )
          }
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({ message: 'Failed to fetch status' })}\n\n`
            )
          )
        }
      }, 3000) // 每 3 秒轮询

      // 发送心跳保持连接
      const heartbeatId = setInterval(() => {
        controller.enqueue(encoder.encode(': heartbeat\n\n'))
      }, 15000)

      // 客户端断开连接时清理
      req.signal.addEventListener('abort', () => {
        clearInterval(intervalId)
        clearInterval(heartbeatId)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
```

### 4.4 进阶方案：Control Plane 原生 SSE 代理

如果 Control Plane API 本身支持 SSE 推送，可以直接做流式代理：

```typescript
// src/app/api/events/stream/route.ts
import { auth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // 代理 Control Plane 的 SSE 端点
    const upstreamResponse = await fetch(
      `${process.env.CONTROL_PLANE_API_URL}/v1/events/stream`,
      {
        headers: {
          Authorization: `Bearer ${process.env.CONTROL_PLANE_API_KEY}`,
          Accept: 'text/event-stream',
        },
        signal: req.signal, // 透传 abort signal
      }
    )

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      return NextResponse.json(
        { error: 'Failed to connect to event stream' },
        { status: 502 }
      )
    }

    // 直接转发上游的 ReadableStream
    return new Response(upstreamResponse.body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Event stream connection failed' },
      { status: 502 }
    )
  }
}
```

### 4.5 客户端 Hook

```typescript
// src/hooks/use-event-source.ts
'use client'

import { useEffect, useRef, useCallback, useState } from 'react'

interface UseEventSourceOptions<T> {
  url: string
  event?: string
  onMessage?: (data: T) => void
  onError?: (error: Event) => void
  enabled?: boolean
}

interface UseEventSourceReturn<T> {
  data: T | null
  status: 'connecting' | 'open' | 'closed' | 'error'
  close: () => void
}

export function useEventSource<T>({
  url,
  event = 'message',
  onMessage,
  onError,
  enabled = true,
}: UseEventSourceOptions<T>): UseEventSourceReturn<T> {
  const [data, setData] = useState<T | null>(null)
  const [status, setStatus] = useState<
    'connecting' | 'open' | 'closed' | 'error'
  >('connecting')
  const esRef = useRef<EventSource | null>(null)

  const close = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
      setStatus('closed')
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      close()
      return
    }

    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => {
      setStatus('open')
    }

    es.onerror = (e) => {
      setStatus('error')
      onError?.(e)
      // EventSource 会自动重连，状态会重新变为 connecting
      setTimeout(() => {
        if (es.readyState === EventSource.CONNECTING) {
          setStatus('connecting')
        }
      }, 100)
    }

    const handler = (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as T
        setData(parsed)
        onMessage?.(parsed)
      } catch {
        // 忽略解析错误（如心跳）
      }
    }

    if (event === 'message') {
      es.onmessage = handler
    } else {
      es.addEventListener(event, handler)
    }

    return () => {
      es.close()
    }
  }, [url, event, enabled, close, onMessage, onError])

  return { data, status, close }
}
```

### 4.6 客户端使用示例

```typescript
// src/app/dashboard/containers/container-status-live.tsx
'use client'

import { useEventSource } from '@/hooks/use-event-source'
import type { Container } from '@/lib/api/types'
import { Badge } from '@/components/ui/badge'

interface ContainerStatusEvent {
  containers: Array<{
    id: string
    status: Container['status']
    cpuUsage: number
    memoryUsage: number
  }>
}

export function ContainerStatusLive({
  initialContainers,
}: {
  initialContainers: Container[]
}) {
  const { data, status } = useEventSource<ContainerStatusEvent>({
    url: '/api/events/containers',
    event: 'container-status',
  })

  // 合并初始数据和实时更新
  const containers = initialContainers.map((container) => {
    const update = data?.containers.find((c) => c.id === container.id)
    if (update) {
      return { ...container, ...update }
    }
    return container
  })

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm text-muted-foreground">实时状态</span>
        <Badge variant={status === 'open' ? 'default' : 'secondary'}>
          {status === 'open' ? '已连接' : '连接中...'}
        </Badge>
      </div>
      {/* 渲染容器列表... */}
    </div>
  )
}
```

### 4.7 何时需要 WebSocket

如果未来 AgentPod 增加以下功能，可考虑引入 WebSocket：

- **交互式终端**: 需要双向字节流传输 (xterm.js + WebSocket)
- **协作编辑**: 多用户同时编辑配置文件
- **实时聊天**: 管理员与 Agent 的实时对话

WebSocket 方案推荐使用 **Socket.IO** 或直接使用 **原生 WebSocket**，需要独立的 WebSocket 服务器（不经过 Next.js Route Handler）。

---

## 5. 推荐技术栈组合

### 5.1 最终技术栈

| 层级 | 技术选型 | 理由 |
|------|---------|------|
| **框架** | Next.js 16 (App Router) | Server Components、Streaming、Route Handlers |
| **UI 组件** | shadcn/ui + Tailwind CSS v4 | 可定制、无锁定、生态丰富 |
| **模板基础** | Vercel 官方 shadcn Admin Dashboard | Colocation-first 架构，官方维护 |
| **认证** | Auth.js v5 (Credentials Provider) | 单管理员、JWT、无数据库依赖 |
| **状态管理** | Zustand (客户端) | 轻量、简洁、与 Server Components 配合好 |
| **表单验证** | Zod + React Hook Form | 类型安全、服务端/客户端共用 schema |
| **数据表格** | TanStack Table | shadcn/ui 内置集成，功能强大 |
| **图表** | Recharts | shadcn/ui 官方推荐的图表库 |
| **BFF 层** | Next.js Route Handlers | 类型安全代理，认证注入，请求转换 |
| **实时推送** | SSE (Server-Sent Events) | 单向推送够用，基础设施简单 |
| **代码质量** | TypeScript strict + ESLint + Prettier | 严格类型检查 |

### 5.2 项目结构

```
src/
├── app/
│   ├── (auth)/
│   │   └── login/
│   │       └── page.tsx
│   ├── dashboard/
│   │   ├── layout.tsx              # 认证保护 + 侧边栏布局
│   │   ├── page.tsx                # 概览仪表盘
│   │   ├── containers/
│   │   │   ├── page.tsx            # 容器列表（Server Component）
│   │   │   ├── [id]/
│   │   │   │   └── page.tsx        # 容器详情
│   │   │   ├── container-table.tsx  # 数据表格（Client Component）
│   │   │   ├── container-status-live.tsx  # 实时状态
│   │   │   └── error.tsx           # 错误边界
│   │   ├── agents/
│   │   │   ├── page.tsx
│   │   │   └── ...
│   │   └── settings/
│   │       └── page.tsx
│   └── api/
│       ├── auth/[...nextauth]/
│       │   └── route.ts            # Auth.js handlers
│       ├── containers/
│       │   └── route.ts            # Container CRUD (BFF)
│       ├── events/
│       │   └── containers/
│       │       └── route.ts        # SSE 端点
│       └── proxy/[...path]/
│           └── route.ts            # 通用代理（备用）
├── components/
│   └── ui/                         # shadcn/ui 组件
├── hooks/
│   ├── use-event-source.ts
│   └── ...
├── lib/
│   ├── auth.ts                     # Auth.js 配置
│   └── api/
│       ├── client.ts               # 类型安全 API client
│       └── types.ts                # 共享类型定义
└── proxy.ts                        # 路由保护（Next.js 16）
```

### 5.3 实施路径

#### Phase 1: 基础框架（1-2 天）

1. 从 Vercel 官方 shadcn Admin Dashboard 模板初始化项目
2. 配置 Auth.js v5 Credentials Provider
3. 实现登录页面和路由保护
4. 设置 BFF 代理层基础架构

#### Phase 2: 核心页面（3-5 天）

1. Dashboard 概览页（统计卡片 + 图表）
2. Container 管理页（Data Table + CRUD）
3. Agent 管理页
4. 设置页面

#### Phase 3: 实时功能（1-2 天）

1. 实现 SSE 端点
2. 集成 `useEventSource` Hook
3. Container 状态实时更新
4. 连接状态指示器

#### Phase 4: 优化（1-2 天）

1. 错误边界和加载状态
2. 响应式设计调优
3. 性能优化（Streaming、Suspense）
4. 部署配置

### 5.4 关键依赖版本

```json
{
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "next-auth": "^5.0.0",
    "bcryptjs": "^2.4.3",
    "zod": "^3.23.0",
    "zustand": "^5.0.0",
    "@tanstack/react-table": "^8.20.0",
    "recharts": "^2.15.0",
    "react-hook-form": "^7.54.0",
    "@hookform/resolvers": "^3.9.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/bcryptjs": "^2.4.6",
    "tailwindcss": "^4.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.4.0"
  }
}
```

---

## 参考资料

- [Vercel Next.js + shadcn/ui Admin Dashboard Template](https://vercel.com/templates/next.js/next-js-and-shadcn-ui-admin-dashboard)
- [next-shadcn-dashboard-starter (Kiranism)](https://github.com/Kiranism/next-shadcn-dashboard-starter)
- [shadcn-admin (satnaing)](https://github.com/satnaing/shadcn-admin)
- [shadcnblocks Admin Dashboard](https://www.shadcnblocks.com/admin-dashboard)
- [18 Best Free Shadcn Admin Dashboard Templates 2026](https://adminlte.io/blog/shadcn-admin-dashboard-templates/)
- [Auth.js v5 Credentials Provider](https://authjs.dev/getting-started/providers/credentials)
- [Auth.js v5 Route Protection](https://authjs.dev/getting-started/session-management/protecting)
- [Next.js 16 Middleware to Proxy Rename](https://nextjs.org/docs/messages/middleware-to-proxy)
- [Next.js Backend for Frontend Guide](https://nextjs.org/docs/app/guides/backend-for-frontend)
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [BFF Pattern with Next.js API Routes](https://medium.com/digigeek/bff-backend-for-frontend-pattern-with-next-js-api-routes-secure-and-scalable-architecture-d6e088a39855)
- [Next.js Server Components Data Fetching](https://nextjs.org/docs/app/getting-started/fetching-data)
- [Next.js Error Handling Patterns](https://nextjs.org/docs/app/getting-started/error-handling)
- [Streaming in Next.js 15: WebSockets vs SSE](https://hackernoon.com/streaming-in-nextjs-15-websockets-vs-server-sent-events)
- [Real-Time Notifications with SSE in Next.js](https://www.pedroalonso.net/blog/sse-nextjs-real-time-notifications/)
- [Next.js Real-Time Chat: WebSocket and SSE](https://eastondev.com/blog/en/posts/dev/20260107-nextjs-realtime-chat/)
- [WebSockets vs SSE Comparison](https://ably.com/blog/websockets-vs-sse)
- [Fixing Slow SSE Streaming in Next.js](https://medium.com/@oyetoketoby80/fixing-slow-sse-server-sent-events-streaming-in-next-js-and-vercel-99f42fbdb996)
- [CVE-2025-29927 - Next.js Middleware Auth Bypass](https://javascript.plainenglish.io/stop-crying-over-auth-a-senior-devs-guide-to-next-js-15-auth-js-v5-42a57bc5b4ce)
