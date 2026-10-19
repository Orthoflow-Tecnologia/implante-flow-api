import { createHash } from 'node:crypto'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { Database } from '../db/database.js'
import { ClinicValidationError } from '../clinic/rules.js'
import type { ObjectStore } from '../files/object-store.js'

export type DocumentSigner = (pdf: Uint8Array) => Promise<{ pdf: Uint8Array; signed: boolean } | null>

type SiteRow = {
  id: string
  fdi: number
  role: string
}

type PieceRow = {
  site_id: string
  manufacturer: string
  model: string
  size: string
  manufactured_on: string | Date | null
  expires_on: string | Date | null
}

type GraftRow = {
  site_id: string
  origin: string
  manufacturer: string
  model: string
  lot: string
  expires_on: string | Date | null
  donor_site: string
}

function day(value: string | Date | null): string {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

export async function issueCertificate(
  database: Database,
  store: ObjectStore,
  dentistId: string,
  procedureId: string,
  signer?: DocumentSigner,
): Promise<{ version: number; sha256: string; signed: boolean; downloadUrl: string } | null> {
  return database.withDentist(dentistId, async (tx) => {
    const procedures = await tx.query<{
      patient_id: string
      surgery_date: string | Date
      patient_name: string
      birth_date: string | Date
      guardian: string
      cro: string
      cro_uf: string
      dentist_name: string
    }>(
      `SELECT procedures.patient_id, procedures.surgery_date, patients.name AS patient_name,
              patients.birth_date, patients.guardian, dentists.cro, dentists.cro_uf, dentists.name AS dentist_name
       FROM procedures
       JOIN patients ON patients.id = procedures.patient_id
       JOIN dentists ON dentists.id = procedures.dentist_id
       WHERE procedures.id = $1
       FOR UPDATE`,
      [procedureId],
    )
    const procedure = procedures[0]
    if (!procedure) return null
    const sites = await tx.query<SiteRow>('SELECT id, fdi, role FROM tooth_sites WHERE procedure_id = $1 ORDER BY fdi', [
      procedureId,
    ])
    const siteIds = sites.map((site) => site.id)
    const pieces = siteIds.length === 0 ? [] : await tx.query<PieceRow>(
      `SELECT site_id, manufacturer, model, size, manufactured_on, expires_on
       FROM implant_pieces WHERE site_id = ANY($1::uuid[])`,
      [siteIds],
    )
    const grafts = siteIds.length === 0 ? [] : await tx.query<GraftRow>(
      `SELECT site_id, origin, manufacturer, model, lot, expires_on, donor_site
       FROM graft_materials WHERE site_id = ANY($1::uuid[])`,
      [siteIds],
    )
    const missing = missingCertificateFields(procedure, sites, pieces, grafts)
    if (missing.length > 0) throw new ClinicValidationError(`Faltam campos do certificado: ${missing.join(', ')}.`)

    const lines = certificateLines(procedure, sites, pieces, grafts)
    const original = await renderPdf(lines)
    const signed = signer ? await signer(original) : null
    const bytes = signed?.pdf ?? original
    const isSigned = signed?.signed === true
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const versions = await tx.query<{ version: number }>(
      'SELECT COALESCE(MAX(version), 0) + 1 AS version FROM certificate_versions WHERE procedure_id = $1',
      [procedureId],
    )
    const version = versions[0]?.version ?? 1
    const key = `dentists/${dentistId}/procedures/${procedureId}/certificates/v${version}.pdf`
    await store.put({ key, body: bytes, contentType: 'application/pdf' })
    await tx.query(
      `INSERT INTO certificate_versions (dentist_id, procedure_id, version, object_key, sha256, signed)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [dentistId, procedureId, version, key, sha256, isSigned],
    )
    return { version, sha256, signed: isSigned, downloadUrl: await store.presignGet(key) }
  })
}

function missingCertificateFields(
  procedure: { cro: string; cro_uf: string; patient_name: string; surgery_date: string | Date },
  sites: SiteRow[],
  pieces: PieceRow[],
  grafts: GraftRow[],
): string[] {
  const missing: string[] = []
  if (!procedure.cro || !procedure.cro_uf) missing.push('CRO/UF')
  if (!procedure.patient_name) missing.push('paciente')
  if (!day(procedure.surgery_date)) missing.push('data da cirurgia')
  if (sites.length === 0) missing.push('dentes')
  for (const site of sites.filter((item) => item.role === 'pilar')) {
    const piece = pieces.find((item) => item.site_id === site.id)
    if (!piece?.manufacturer || !piece.model || !piece.size || !day(piece.manufactured_on) || !day(piece.expires_on)) {
      missing.push(`peça do dente ${site.fdi}`)
    }
    for (const graft of grafts.filter((item) => item.site_id === site.id)) {
      if (graft.origin === 'autogeno' && !graft.donor_site) missing.push(`região doadora do dente ${site.fdi}`)
      if (graft.origin === 'biomaterial' && (!graft.manufacturer || !graft.model || !graft.lot || !day(graft.expires_on))) {
        missing.push(`enxerto do dente ${site.fdi}`)
      }
    }
  }
  return missing
}

function certificateLines(
  procedure: {
    dentist_name: string
    cro: string
    cro_uf: string
    patient_name: string
    birth_date: string | Date
    surgery_date: string | Date
  },
  sites: SiteRow[],
  pieces: PieceRow[],
  grafts: GraftRow[],
): string[] {
  const lines = [
    'Certificado de procedência',
    `Profissional: ${procedure.dentist_name}`,
    `CRO/UF: ${procedure.cro}/${procedure.cro_uf}`,
    `Paciente: ${procedure.patient_name}`,
    `Nascimento: ${day(procedure.birth_date)}`,
    `Cirurgia: ${day(procedure.surgery_date)}`,
    `Dentes: ${sites.map((site) => site.fdi).join(', ')}`,
  ]
  for (const site of sites) {
    if (site.role === 'pontico') {
      lines.push(`Dente ${site.fdi}: pôntico`)
      continue
    }
    const piece = pieces.find((item) => item.site_id === site.id)
    if (piece) {
      lines.push(
        `Dente ${site.fdi}: ${piece.manufacturer} ${piece.model}, ${piece.size}, fabricação ${day(piece.manufactured_on)}, validade ${day(piece.expires_on)}`,
      )
    }
    for (const graft of grafts.filter((item) => item.site_id === site.id)) {
      lines.push(
        graft.origin === 'autogeno'
          ? `Enxerto do dente ${site.fdi}: autógeno, região ${graft.donor_site}`
          : `Enxerto do dente ${site.fdi}: ${graft.manufacturer} ${graft.model}, lote ${graft.lot}, validade ${day(graft.expires_on)}`,
      )
    }
  }
  lines.push('Sem dados de telefone, foto ou status clínico.')
  return lines
}

async function renderPdf(lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595, 842])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  let y = 800
  for (const line of lines) {
    page.drawText(line, { x: 48, y, size: 11, font })
    y -= 18
  }
  return pdf.save()
}
