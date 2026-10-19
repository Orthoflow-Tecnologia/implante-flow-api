import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/

export function requestIdFrom(headers: IncomingHttpHeaders): string {
  const header = headers['x-request-id']
  const value = Array.isArray(header) ? header[0] : header
  if (value !== undefined && requestIdPattern.test(value)) return value
  return randomUUID()
}
