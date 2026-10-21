import { createHash } from 'node:crypto'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { Database, Queryable } from '../db/database.js'
import { ClinicValidationError, clientUuid } from '../clinic/rules.js'
import type { ObjectStore } from '../files/object-store.js'

export type DocumentSigner = (pdf: Uint8Array) => Promise<{ pdf: Uint8Array; signed: boolean } | null>

export type IssueCertificateInput = {
  copies?: unknown
  locationId?: unknown
}

export type IssuedCertificate = {
  version: number
  sha256: string
  signed: boolean
  downloadUrl: string
  copies: number
  location: { id: string; name: string; address: string } | null
}

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

type LocationSnapshot = {
  id: string
  name: string
  address: string
}

function day(value: string | Date | null): string {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function parseCopies(value: unknown): 1 | 2 {
  if (value === undefined || value === null || value === '') return 1
  const copies = typeof value === 'number' ? value : Number(value)
  if (copies === 1 || copies === 2) return copies
  throw new ClinicValidationError('Quantidade de vias inválida.', 'CERTIFICATE_COPIES_INVALID')
}

export async function issueCertificate(
  database: Database,
  store: ObjectStore,
  dentistId: string,
  procedureId: string,
  input: IssueCertificateInput = {},
  signer?: DocumentSigner,
): Promise<IssuedCertificate | null> {
  const copies = parseCopies(input.copies)
  const requestedLocationId = clientUuid(input.locationId)

  return database.withDentist(dentistId, async (tx) => {
    const procedures = await tx.query<{
      patient_id: string
      modality: string
      surgery_date: string | Date
      patient_name: string
      birth_date: string | Date
      guardian: string
      cro: string
      cro_uf: string
      dentist_name: string
    }>(
      `SELECT procedures.patient_id, procedures.modality, procedures.surgery_date, patients.name AS patient_name,
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
    const pieces =
      siteIds.length === 0
        ? []
        : await tx.query<PieceRow>(
            `SELECT site_id, manufacturer, model, size, manufactured_on, expires_on
             FROM implant_pieces WHERE site_id = ANY($1::uuid[])`,
            [siteIds],
          )
    const grafts =
      siteIds.length === 0
        ? []
        : await tx.query<GraftRow>(
            `SELECT site_id, origin, manufacturer, model, lot, expires_on, donor_site
             FROM graft_materials WHERE site_id = ANY($1::uuid[])`,
            [siteIds],
          )

    assertCertificateReady(procedure, sites, pieces, grafts)

    const location = await resolveAttendanceLocation(
      tx,
      procedure.patient_id,
      requestedLocationId,
    )

    const lines = certificateLines(procedure, sites, pieces, grafts, location)
    const original = await renderPdf(lines, copies)
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
      `INSERT INTO certificate_versions
         (dentist_id, procedure_id, version, object_key, sha256, signed, copies, location_id, location_name, location_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        dentistId,
        procedureId,
        version,
        key,
        sha256,
        isSigned,
        copies,
        location?.id ?? null,
        location?.name ?? '',
        location?.address ?? '',
      ],
    )
    return {
      version,
      sha256,
      signed: isSigned,
      downloadUrl: await store.presignGet(key),
      copies,
      location: location ? { id: location.id, name: location.name, address: location.address } : null,
    }
  })
}

function assertCertificateReady(
  procedure: {
    cro: string
    cro_uf: string
    patient_name: string
    surgery_date: string | Date
    modality: string
    guardian: string
    birth_date: string | Date
  },
  sites: SiteRow[],
  pieces: PieceRow[],
  grafts: GraftRow[],
): void {
  if (!procedure.cro || !procedure.cro_uf) {
    throw new ClinicValidationError(
      'Para emitir certificado, é necessário completar o cadastro',
      'DENTIST_CRO_REQUIRED',
    )
  }
  const missing = missingCertificateFields(procedure, sites, pieces, grafts)
  if (missing.length > 0) {
    throw new ClinicValidationError(`Faltam campos do certificado: ${missing.join(', ')}.`)
  }
}

function missingCertificateFields(
  procedure: {
    patient_name: string
    surgery_date: string | Date
    modality: string
    guardian: string
    birth_date: string | Date
  },
  sites: SiteRow[],
  pieces: PieceRow[],
  grafts: GraftRow[],
): string[] {
  const missing: string[] = []
  if (!procedure.patient_name) missing.push('paciente')
  if (!day(procedure.surgery_date)) missing.push('data da cirurgia')
  if (sites.length === 0) missing.push('dentes')

  const birth = day(procedure.birth_date)
  if (birth) {
    const ageMs = Date.now() - new Date(`${birth}T00:00:00Z`).getTime()
    const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000)
    if (ageYears < 18 && !procedure.guardian) missing.push('responsável legal')
  }

  const requirePieces = procedure.modality === 'implante'
  for (const site of sites.filter((item) => item.role === 'pilar')) {
    if (requirePieces) {
      const piece = pieces.find((item) => item.site_id === site.id)
      if (!piece?.manufacturer || !piece.model || !piece.size) {
        missing.push(`peça do dente ${site.fdi}`)
      }
    }
    for (const graft of grafts.filter((item) => item.site_id === site.id)) {
      if (graft.origin === 'autogeno' && !graft.donor_site) missing.push(`região doadora do dente ${site.fdi}`)
      if (
        graft.origin === 'biomaterial' &&
        (!graft.manufacturer || !graft.model || !graft.lot)
      ) {
        missing.push(`enxerto do dente ${site.fdi}`)
      }
    }
    if (procedure.modality === 'enxerto' && grafts.every((item) => item.site_id !== site.id)) {
      missing.push(`enxerto do dente ${site.fdi}`)
    }
  }
  return missing
}

async function resolveAttendanceLocation(
  tx: Queryable,
  patientId: string,
  requestedLocationId: string | null,
): Promise<LocationSnapshot | null> {
  const linked = await tx.query<LocationSnapshot>(
    `SELECT care_locations.id, care_locations.name, care_locations.address
     FROM patient_locations
     JOIN care_locations ON care_locations.id = patient_locations.location_id
     WHERE patient_locations.patient_id = $1 AND care_locations.active
     ORDER BY care_locations.name`,
    [patientId],
  )
  const candidates = linked.length
    ? linked
    : await tx.query<LocationSnapshot>(
        `SELECT id, name, address
         FROM care_locations
         WHERE active AND dentist_id = (SELECT dentist_id FROM patients WHERE id = $1)
         ORDER BY name`,
        [patientId],
      )

  if (requestedLocationId) {
    const match = candidates.find((item) => item.id === requestedLocationId)
    if (!match) {
      throw new ClinicValidationError(
        'Selecione um local de atendimento válido.',
        'CERTIFICATE_LOCATION_REQUIRED',
      )
    }
    return match
  }

  if (candidates.length === 1) return candidates[0] ?? null
  if (candidates.length > 1) {
    throw new ClinicValidationError(
      'Selecione o local de atendimento deste certificado.',
      'CERTIFICATE_LOCATION_REQUIRED',
    )
  }
  throw new ClinicValidationError(
    'Cadastre um local de atendimento para emitir o certificado.',
    'CERTIFICATE_LOCATION_REQUIRED',
  )
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
  location: LocationSnapshot | null,
): string[] {
  const lines = [
    'Certificado de procedência',
    `Profissional: ${procedure.dentist_name}`,
    `CRO: ${procedure.cro_uf} ${procedure.cro}`,
    `Paciente: ${procedure.patient_name}`,
    `Nascimento: ${day(procedure.birth_date)}`,
    `Cirurgia: ${day(procedure.surgery_date)}`,
    `Dentes: ${sites.map((site) => site.fdi).join(', ')}`,
  ]
  if (location) {
    lines.push(`Local de atendimento: ${location.name}`)
    if (location.address.trim()) lines.push(`Endereço: ${location.address.trim()}`)
  }
  for (const site of sites) {
    if (site.role === 'pontico') {
      lines.push(`Dente ${site.fdi}: pôntico`)
      continue
    }
    const piece = pieces.find((item) => item.site_id === site.id)
    if (piece?.manufacturer || piece?.model || piece?.size) {
      const details = [
        [piece.manufacturer, piece.model].filter(Boolean).join(' '),
        piece.size,
        day(piece.manufactured_on) ? `fabricação ${day(piece.manufactured_on)}` : '',
        day(piece.expires_on) ? `validade ${day(piece.expires_on)}` : '',
      ].filter(Boolean)
      lines.push(`Dente ${site.fdi}: ${details.join(', ')}`)
    }
    for (const graft of grafts.filter((item) => item.site_id === site.id)) {
      lines.push(
        graft.origin === 'autogeno'
          ? `Enxerto do dente ${site.fdi}: autógeno, região ${graft.donor_site}`
          : `Enxerto do dente ${site.fdi}: ${graft.manufacturer} ${graft.model}, lote ${graft.lot}${day(graft.expires_on) ? `, validade ${day(graft.expires_on)}` : ''}`,
      )
    }
  }
  lines.push('Sem dados de telefone, foto ou status clínico.')
  return lines
}

async function renderPdf(lines: string[], copies: 1 | 2): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  for (let copy = 1; copy <= copies; copy += 1) {
    const page = pdf.addPage([595, 842])
    let y = 800
    const viaLabel = copies === 2 ? `${copy}ª via` : ''
    if (viaLabel) {
      page.drawText(viaLabel, { x: 48, y, size: 12, font: bold })
      y -= 22
    }
    for (const line of lines) {
      page.drawText(line, { x: 48, y, size: 11, font })
      y -= 18
      if (y < 48) break
    }
  }
  return pdf.save()
}
