import { Writable } from 'node:stream'
import type { Database } from '../db/database.js'
import {
  PERSIST_MIN_PINO_LEVEL,
  systemLogLevelFromPino,
  writeSystemLogSafe,
} from './system-logs.js'

type PinoLine = {
  level?: number
  msg?: string
  message?: string
  requestId?: string
  reqId?: string
  err?: { message?: string; type?: string; stack?: string }
  [key: string]: unknown
}

/**
 * Destino Pino que espelha warn+ no Postgres sem bloquear o event loop
 * e sem substituir o stdout (usar com pino.multistream).
 */
export function createDbLogTransport(database: Database): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      let parsed: PinoLine | null = null
      try {
        parsed = JSON.parse(chunk.toString()) as PinoLine
      } catch {
        callback()
        return
      }

      const levelNum = typeof parsed.level === 'number' ? parsed.level : 0
      if (levelNum < PERSIST_MIN_PINO_LEVEL) {
        callback()
        return
      }

      const level = systemLogLevelFromPino(levelNum)
      if (!level) {
        callback()
        return
      }

      const message =
        (typeof parsed.msg === 'string' && parsed.msg) ||
        (typeof parsed.message === 'string' && parsed.message) ||
        (typeof parsed.err?.message === 'string' && parsed.err.message) ||
        'log'

      const requestId =
        (typeof parsed.requestId === 'string' && parsed.requestId) ||
        (typeof parsed.reqId === 'string' && parsed.reqId) ||
        null

      const context: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (
          key === 'level' ||
          key === 'time' ||
          key === 'pid' ||
          key === 'hostname' ||
          key === 'msg' ||
          key === 'message' ||
          key === 'v'
        ) {
          continue
        }
        context[key] = value
      }

      void writeSystemLogSafe(database, {
        level,
        message,
        source: 'pino',
        requestId,
        context,
      }).finally(() => callback())
    },
  })
}
