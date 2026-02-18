import { z } from 'zod'
import type { AgentAdapter, ContainerSpec } from '@agentpod/shared'

function applyTemplate(value: string, platform: { domain: string; dataDir: string }): string {
  return value
    .replaceAll('{{platform.domain}}', platform.domain)
    .replaceAll('{{pod.dataDir}}', platform.dataDir)
}

export const openclawAdapter: AgentAdapter = {
  meta: {
    id: 'openclaw',
    label: 'OpenClaw Gateway',
    description: 'Multi-channel AI assistant supporting 8+ messaging platforms',
    version: '1.0.0',
    category: 'ai-assistant',
    tags: ['ai', 'chatbot', 'telegram', 'discord', 'whatsapp', 'feishu'],
  },

  containerSpec: {
    image: process.env.AGENTPOD_OPENCLAW_IMAGE ?? 'openclaw:production',
    command: [
      'node',
      'dist/index.js',
      'gateway',
      '--bind',
      'lan',
      '--port',
      '18789',
      '--allow-unconfigured',
    ],
    environment: {
      HOME: '/home/node',
      TERM: 'xterm-256color',
      NODE_ENV: 'production',
      NPM_CONFIG_PREFIX: '/home/node/.npm-global',
      PATH: '/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin',
    },
    volumes: [],
    ports: [
      {
        container: 18789,
        protocol: 'tcp',
        primary: true,
        websocket: true,
      },
    ],
    healthCheck: {
      command: ['CMD', 'wget', '-qO-', 'http://127.0.0.1:18789/health'],
      intervalSeconds: 30,
      timeoutSeconds: 10,
      retries: 3,
      startPeriodSeconds: 15,
    },
    resources: { memoryMb: 512, cpus: 1 },
    restartPolicy: 'unless-stopped',
    user: 'node',
  },

  configSchema: {
    schema: z.object({
      agentName: z.string().min(1).max(50).default('Assistant'),
      personality: z.string().max(2000).optional(),
      claudeSessionKey: z.string().optional(),
      telegramBotToken: z.string().optional(),
      discordBotToken: z.string().optional(),
    }),
    uiHints: {
      agentName: { label: 'Agent Name', group: 'Identity' },
      personality: { label: 'Personality (SOUL.md)', group: 'Identity' },
      claudeSessionKey: {
        label: 'Claude Session Key',
        sensitive: true,
        group: 'AI Model',
      },
      telegramBotToken: {
        label: 'Telegram Bot Token',
        sensitive: true,
        group: 'Messaging',
      },
      discordBotToken: {
        label: 'Discord Bot Token',
        sensitive: true,
        group: 'Messaging',
      },
    },
    defaults: { agentName: 'Assistant' },
    envMapping: { claudeSessionKey: 'CLAUDE_AI_SESSION_KEY' },
  },

  lifecycle: {
    onBeforeCreate: async (ctx) => ({
      initialFiles: [
        {
          path: '.openclaw/openclaw.json',
          content: JSON.stringify(
            {
              gateway: { port: 18789 },
              ...(ctx.config.telegramBotToken
                ? {
                    telegram: {
                      default: {
                        botToken: ctx.config.telegramBotToken,
                      },
                    },
                  }
                : {}),
              ...(ctx.config.discordBotToken
                ? {
                    discord: {
                      default: {
                        botToken: ctx.config.discordBotToken,
                      },
                    },
                  }
                : {}),
            },
            null,
            2,
          ),
        },
        ...(ctx.config.personality
          ? [
              {
                path: '.openclaw/workspace/SOUL.md',
                content: String(ctx.config.personality),
              },
            ]
          : []),
      ],
    }),

    onConfigChange: async (ctx) => {
      if (ctx.changedFields.some((field) => ['claudeSessionKey'].includes(field))) {
        return { action: 'restart' }
      }

      if (ctx.changedFields.includes('personality')) {
        return { action: 'none' }
      }

      return { action: 'none' }
    },
  },

  resolveContainerSpec: (config, platform): ContainerSpec => {
    const parsed = openclawAdapter.configSchema.schema.parse({
      ...openclawAdapter.configSchema.defaults,
      ...config,
    })

    const mappedEnv: Record<string, string> = {}
    for (const [field, envVar] of Object.entries(openclawAdapter.configSchema.envMapping)) {
      const value = parsed[field as keyof typeof parsed]
      if (value !== undefined && value !== null && value !== '') {
        mappedEnv[envVar] = String(value)
      }
    }

    return {
      ...openclawAdapter.containerSpec,
      command: openclawAdapter.containerSpec.command?.map((part) =>
        applyTemplate(part, platform),
      ),
      environment: {
        ...openclawAdapter.containerSpec.environment,
        AGENT_NAME: parsed.agentName,
        PLATFORM_DOMAIN: platform.domain,
        ...mappedEnv,
      },
      volumes: [
        {
          containerPath: '/home/node',
          source: platform.dataDir,
          persistent: true,
        },
      ],
    }
  },
}
