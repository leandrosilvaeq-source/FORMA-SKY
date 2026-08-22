import { describe, expect, it } from 'vitest'
import { DURATION_HELP_TEXT, formatSecondsToHHMMSS, parseDurationToSeconds } from './durationField'

function seconds(raw: string): number | null {
  const result = parseDurationToSeconds(raw)
  if (!result.ok) throw new Error(`esperava sucesso para "${raw}", veio erro: ${result.error}`)
  return result.seconds
}

describe('parseDurationToSeconds — tabela aprovada', () => {
  it.each([
    ['1h30min', 5400],
    ['1h 30min', 5400],
    ['1h30m', 5400],
    ['1,5h', 5400],
    ['1.5h', 5400],
    ['1,5', 5400],
    ['1.5', 5400],
    ['01:30:00', 5400],
    ['12:30', 45000],
    ['90:00', 5400],
    ['30m45s', 1845],
    ['30m 45s', 1845],
    ['45s', 45],
    ['90m', 5400],
    ['0,5h', 1800],
  ])('"%s" -> %i segundos', (input, expectedSeconds) => {
    expect(seconds(input)).toBe(expectedSeconds)
  })

  it.each([
    ['1h30min', '01:30:00'],
    ['1h 30min', '01:30:00'],
    ['1h30m', '01:30:00'],
    ['1,5h', '01:30:00'],
    ['1.5h', '01:30:00'],
    ['1,5', '01:30:00'],
    ['1.5', '01:30:00'],
    ['01:30:00', '01:30:00'],
    ['12:30', '12:30:00'],
    ['90:00', '01:30:00'],
    ['30m45s', '00:30:45'],
    ['30m 45s', '00:30:45'],
    ['45s', '00:00:45'],
    ['90m', '01:30:00'],
    ['0,5h', '00:30:00'],
  ])('"%s" normaliza para %s (parse + format)', (input, expectedFormatted) => {
    const result = parseDurationToSeconds(input)
    if (!result.ok) throw new Error('esperava sucesso')
    expect(formatSecondsToHHMMSS(result.seconds as number)).toBe(expectedFormatted)
  })
})

describe('parseDurationToSeconds — regra de dois blocos separados por dois-pontos', () => {
  it('"12:30" é HH:MM (primeiro bloco < 24)', () => {
    expect(seconds('12:30')).toBe(12 * 3600 + 30 * 60)
  })

  it('"23:59" continua HH:MM (limite superior de hora plausível)', () => {
    expect(seconds('23:59')).toBe(23 * 3600 + 59 * 60)
  })

  it('"24:00" já é MM:SS (primeiro bloco >= 24 não pode ser hora)', () => {
    expect(seconds('24:00')).toBe(24 * 60)
  })

  it('"90:00" é MM:SS -> 90 minutos = 01:30:00', () => {
    expect(formatSecondsToHHMMSS(seconds('90:00') as number)).toBe('01:30:00')
  })

  it('minutos e segundos abaixo de 24 exigem unidade explícita ("12m30s"), nunca "12:30"', () => {
    // "12:30" é sempre 12h30min — para 12min30s, a única forma aceita é
    // com unidade explícita.
    expect(seconds('12m30s')).toBe(12 * 60 + 30)
    expect(seconds('12:30')).not.toBe(12 * 60 + 30)
  })

  it('três blocos são sempre HH:MM:SS, mesmo com o primeiro bloco pequeno', () => {
    expect(seconds('00:12:30')).toBe(12 * 60 + 30)
  })
})

describe('parseDurationToSeconds — espaço entre unidades', () => {
  it('aceita espaço entre cada bloco de unidade', () => {
    expect(seconds('1h 30min')).toBe(5400)
    expect(seconds('30m 45s')).toBe(1845)
  })

  it('aceita sem nenhum espaço entre blocos', () => {
    expect(seconds('1h30min')).toBe(5400)
    expect(seconds('30m45s')).toBe(1845)
  })
})

describe('parseDurationToSeconds — vírgula e ponto decimal', () => {
  it('vírgula e ponto são equivalentes em horas decimais com unidade', () => {
    expect(seconds('1,25h')).toBe(seconds('1.25h'))
    expect(seconds('1,25h')).toBe(3600 + 900)
  })

  it('vírgula e ponto são equivalentes em número puro (sem unidade)', () => {
    expect(seconds('2,5')).toBe(seconds('2.5'))
    expect(seconds('2,5')).toBe(2 * 3600 + 1800)
  })
})

describe('parseDurationToSeconds — normalização de minutos/segundos excedentes', () => {
  it('minutos excedentes em HH:MM:SS carregam para horas (01:90:00 -> 02:30:00)', () => {
    expect(formatSecondsToHHMMSS(seconds('01:90:00') as number)).toBe('02:30:00')
  })

  it('segundos excedentes em HH:MM:SS carregam para minutos (00:00:90 -> 00:01:30)', () => {
    expect(formatSecondsToHHMMSS(seconds('00:00:90') as number)).toBe('00:01:30')
  })

  it('minutos excedentes em sufixo de unidade carregam para horas (90m -> 01:30:00)', () => {
    expect(formatSecondsToHHMMSS(seconds('90m') as number)).toBe('01:30:00')
  })

  it('segundos excedentes em sufixo de unidade carregam para minutos (90s -> 00:01:30)', () => {
    expect(formatSecondsToHHMMSS(seconds('90s') as number)).toBe('00:01:30')
  })
})

describe('parseDurationToSeconds — casos especiais', () => {
  it('campo vazio (ou só espaços) -> seconds: null, sem erro', () => {
    expect(parseDurationToSeconds('')).toEqual({ ok: true, seconds: null })
    expect(parseDurationToSeconds('   ')).toEqual({ ok: true, seconds: null })
  })

  it('zero é permitido em qualquer formato -> 00:00:00', () => {
    expect(seconds('0')).toBe(0)
    expect(seconds('0h')).toBe(0)
    expect(seconds('0m')).toBe(0)
    expect(seconds('0s')).toBe(0)
    expect(seconds('00:00:00')).toBe(0)
    expect(formatSecondsToHHMMSS(0)).toBe('00:00:00')
  })

  it.each(['-1h', '-90m', '-1', '-01:30:00'])('rejeita valor negativo: "%s"', (input) => {
    const result = parseDurationToSeconds(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/não pode ser negativa/i)
  })

  it.each(['abc', 'texto qualquer', '1x', 'h', '1:2:3:4', '12:'])('rejeita texto irreconhecível: "%s"', (input) => {
    const result = parseDurationToSeconds(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/duração inválida/i)
  })

  it('horas sem limite artificial pequeno: valores de 3+ dígitos são preservados', () => {
    expect(seconds('100h')).toBe(100 * 3600)
    expect(formatSecondsToHHMMSS(100 * 3600)).toBe('100:00:00')
    expect(seconds('500:00')).toBe(500 * 60)
  })

  it('preserva segundos exatos sem arredondar nem descartar (round-trip)', () => {
    expect(seconds('00:00:01')).toBe(1)
    expect(formatSecondsToHHMMSS(1)).toBe('00:00:01')
    expect(seconds('1s')).toBe(1)
  })

  it('não introduz erro de ponto flutuante em horas decimais (1,1h = exatamente 3960s)', () => {
    // parseFloat('1.1') * 3600 em IEEE 754 pode dar 3959.9999999999995 —
    // a implementação usa aritmética inteira exata para evitar isso.
    expect(seconds('1,1h')).toBe(3960)
    expect(seconds('1.1h')).toBe(3960)
    expect(Number.isInteger(seconds('1,1h'))).toBe(true)
  })

  it('valores colados (texto colado sem formatação extra) são interpretados igual à digitação', () => {
    expect(seconds('1h30min')).toBe(5400)
    expect(seconds(' 1h30min ')).toBe(5400)
  })
})

describe('formatSecondsToHHMMSS', () => {
  it('sempre preenche cada bloco com 2 dígitos', () => {
    expect(formatSecondsToHHMMSS(5)).toBe('00:00:05')
    expect(formatSecondsToHHMMSS(65)).toBe('00:01:05')
  })

  it('não perde nem arredonda segundos', () => {
    expect(formatSecondsToHHMMSS(3661)).toBe('01:01:01')
  })
})

describe('DURATION_HELP_TEXT', () => {
  it('é o texto de ajuda exato aprovado', () => {
    expect(DURATION_HELP_TEXT).toBe('Aceita 1h30min, 1,5h, 01:30:00, 90m ou 30m45s.')
  })
})
