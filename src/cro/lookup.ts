const states = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const

export const croLookupSource = 'https://busca-profissionais.cfo.org.br/'

export type CroLookup = {
  state: 'found' | 'not_found' | 'ambiguous' | 'unavailable' | 'invalid_input'
  category: 'CD'
  uf: string
  registration: string
  source: string
  consultedAt: string
  professional: null
}

export function lookupCroRegistration(
  input: { uf: string | undefined; registration: string | undefined },
  now = new Date(),
): CroLookup {
  const uf = (input.uf ?? '').trim().toUpperCase()
  const registration = (input.registration ?? '').replace(/\D/g, '')
  const valid = states.includes(uf as (typeof states)[number]) && registration.length > 0 && registration.length <= 12
  return {
    state: valid ? 'unavailable' : 'invalid_input',
    category: 'CD',
    uf,
    registration,
    source: croLookupSource,
    consultedAt: now.toISOString(),
    professional: null,
  }
}
