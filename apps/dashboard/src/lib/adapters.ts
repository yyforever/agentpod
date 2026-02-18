import type { AdapterMeta } from '@agentpod/shared'

export const registeredAdapters: AdapterMeta[] = [
  {
    id: 'openclaw',
    label: 'OpenClaw Gateway',
    description: 'Multi-channel AI assistant supporting 8+ messaging platforms',
    version: '1.0.0',
    category: 'ai-assistant',
    tags: ['ai', 'chatbot', 'telegram', 'discord', 'whatsapp', 'feishu'],
  },
]
