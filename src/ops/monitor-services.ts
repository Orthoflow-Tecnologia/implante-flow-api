export type MonitorServiceTarget = {
  id: string
  name: string
  healthUrl: string
}

export type MonitorProbeResult = {
  id: string
  name: string
  status: 'ok' | 'degraded' | 'down' | 'unknown'
  detail: string
}

export type RailwayRuntime = {
  environment: string | null
  service: string | null
  publicDomain: string | null
  deploymentId: string | null
}

const PROBE_TIMEOUT_MS = 3_000

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Formato: id|nome|url_health separados por vírgula. */
export function parseMonitorServices(raw: string | undefined): MonitorServiceTarget[] {
  if (!raw || raw.trim() === '') return []
  const targets: MonitorServiceTarget[] = []
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const parts = trimmed.split('|').map((part) => part.trim())
    if (parts.length !== 3) {
      throw new Error('MONITOR_SERVICES inválido. Use id|nome|url separados por vírgula.')
    }
    const [id, name, healthUrl] = parts
    if (!id || !name || !healthUrl) {
      throw new Error('MONITOR_SERVICES inválido. id, nome e url são obrigatórios.')
    }
    if (!isHttpUrl(healthUrl)) {
      throw new Error('MONITOR_SERVICES inválido. Use URLs http ou https.')
    }
    targets.push({ id, name, healthUrl })
  }
  return targets
}

export function readRailwayRuntime(source: NodeJS.ProcessEnv = process.env): RailwayRuntime | null {
  const environment = source.RAILWAY_ENVIRONMENT_NAME?.trim() || null
  const service = source.RAILWAY_SERVICE_NAME?.trim() || null
  const publicDomain = source.RAILWAY_PUBLIC_DOMAIN?.trim() || null
  const deploymentId = source.RAILWAY_DEPLOYMENT_ID?.trim() || null
  if (!environment && !service && !publicDomain && !deploymentId) return null
  return { environment, service, publicDomain, deploymentId }
}

export async function probeHttpHealth(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: 'ok' | 'down'; detail: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (response.ok) {
      return { status: 'ok', detail: `HTTP ${response.status}` }
    }
    return { status: 'down', detail: `HTTP ${response.status}` }
  } catch (error) {
    const detail =
      error instanceof Error && error.name === 'AbortError'
        ? 'Timeout no probe'
        : 'Falha de conexão'
    return { status: 'down', detail }
  } finally {
    clearTimeout(timer)
  }
}

export async function probeMonitorServices(
  targets: readonly MonitorServiceTarget[],
  fetchImpl: typeof fetch = fetch,
): Promise<MonitorProbeResult[]> {
  return Promise.all(
    targets.map(async (target) => {
      const result = await probeHttpHealth(target.healthUrl, fetchImpl)
      return {
        id: target.id,
        name: target.name,
        status: result.status,
        detail: result.detail,
      }
    }),
  )
}
