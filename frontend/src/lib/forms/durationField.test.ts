import { describe, expect, it } from 'vitest'
import {
  DURATION_HELP_TEXT,
  formatSecondsAdaptive,
  formatSecondsToHHMMSS,
  parseDurationToSeconds,
} from './durationField'

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

  it.each(['abc', 'texto qualquer', '1x', 'h', '1:2:3:4', '12:'])(
    'rejeita texto irreconhecível: "%s"',
    (input) => {
      const result = parseDurationToSeconds(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/duração inválida/i)
    },
  )

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

describe('parseDurationToSeconds — formas compostas "<h>h<min>" e "<min>m<seg>"/"<min>min<seg>"', () => {
  it.each([
    ['18h32', 18 * 3600 + 32 * 60],
    ['18H32', 18 * 3600 + 32 * 60],
    [' 18h32 ', 18 * 3600 + 32 * 60],
    ['00h45', 45 * 60],
    ['1h59', 3600 + 59 * 60],
    ['100h30', 100 * 3600 + 30 * 60],
    ['19m44', 19 * 60 + 44],
    ['19M44', 19 * 60 + 44],
    ['32min20', 32 * 60 + 20],
    ['32MIN20', 32 * 60 + 20],
    [' 32min20 ', 32 * 60 + 20],
    ['1m30', 90],
    ['90m30', 90 * 60 + 30],
  ])('"%s" -> %i segundos', (input, expected) => {
    expect(seconds(input)).toBe(expected)
  })

  it('"18:32" (dois-pontos) e "18h32" (letra) resultam no mesmo total', () => {
    expect(seconds('18h32')).toBe(seconds('18:32'))
  })

  it('o número depois de "h" é sempre minuto; depois de "m"/"min" é sempre segundo', () => {
    expect(seconds('2h5')).toBe(2 * 3600 + 5 * 60)
    expect(seconds('2m5')).toBe(2 * 60 + 5)
    expect(seconds('2min5')).toBe(2 * 60 + 5)
  })

  it('minutos após "h" fora de 0-59 são rejeitados, nunca normalizados em silêncio', () => {
    for (const input of ['18h60', '18h75', '18h99']) {
      const result = parseDurationToSeconds(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/minutos após "h"/i)
    }
  })

  it('segundos após "m"/"min" fora de 0-59 são rejeitados, nunca normalizados em silêncio', () => {
    for (const input of ['19m60', '19m70', '32min99']) {
      const result = parseDurationToSeconds(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/segundos após "m"/i)
    }
  })

  it('minutos antes de "m"/"min" NÃO têm teto (carregam para hora ao formatar)', () => {
    expect(formatSecondsToHHMMSS(seconds('90m30') as number)).toBe('01:30:30')
  })

  it.each(['-1h20', '-19m44'])('valores negativos continuam inválidos: "%s"', (input) => {
    const result = parseDurationToSeconds(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/não pode ser negativa/i)
  })

  it.each(['18h32abc', 'h32', 'min20', '18 h 32 x', '1h2m3', 'e32'])(
    'texto residual ou parcialmente reconhecido é rejeitado: "%s"',
    (input) => {
      const result = parseDurationToSeconds(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/duração inválida/i)
    },
  )

  it('as formas anteriores continuam intactas (nada quebrou com os novos padrões)', () => {
    expect(seconds('18h')).toBe(18 * 3600) // só horas
    expect(seconds('18h32m')).toBe(18 * 3600 + 32 * 60) // sufixo explícito
    expect(seconds('19m')).toBe(19 * 60) // só minutos
    expect(seconds('90m')).toBe(90 * 60) // carrega para 1h30
    expect(seconds('30m45s')).toBe(30 * 60 + 45) // min + seg com unidade
    expect(seconds('1h30min')).toBe(5400)
    expect(seconds('01:30:00')).toBe(5400)
    expect(seconds('90:00')).toBe(5400) // MM:SS quando o 1º bloco >= 24
    expect(seconds('1,5h')).toBe(5400)
  })

  it('NaN, Infinity e notação exponencial são rejeitados', () => {
    for (const input of ['NaN', 'Infinity', '1e3', '1e3h', '18hNaN']) {
      expect(parseDurationToSeconds(input).ok).toBe(false)
    }
  })
})

describe('formatSecondsAdaptive — hh:mm sem segundos, hh:mm:ss quando há', () => {
  it('sem segundos restantes: idêntico a hh:mm (nunca acrescenta :00 à toa)', () => {
    expect(formatSecondsAdaptive(0)).toBe('00:00')
    expect(formatSecondsAdaptive(3600)).toBe('01:00')
    expect(formatSecondsAdaptive(1800)).toBe('00:30')
    expect(formatSecondsAdaptive(100 * 3600)).toBe('100:00')
  })

  it('com segundos restantes: mostra hh:mm:ss (nunca descarta os segundos)', () => {
    expect(formatSecondsAdaptive(1845)).toBe('00:30:45')
    expect(formatSecondsAdaptive(1)).toBe('00:00:01')
    expect(formatSecondsAdaptive(18 * 3600 + 51 * 60 + 44)).toBe('18:51:44')
  })

  it('round-trip exato: parse -> formatSecondsAdaptive -> parse preserva os segundos', () => {
    for (const input of ['30m45s', '00:30:45', '18h32', '19m44', '32min20']) {
      const first = seconds(input) as number
      const reparsed = seconds(formatSecondsAdaptive(first))
      expect(reparsed).toBe(first)
    }
  })
})

describe('parseDurationToSeconds — somas com segundos (exemplos de aceite)', () => {
  it('18h32 + 19m44 = 18h51min44s', () => {
    const total = (seconds('18h32') as number) + (seconds('19m44') as number)
    expect(formatSecondsToHHMMSS(total)).toBe('18:51:44')
  })

  it('19m44 + 32min20 = 52min04s', () => {
    const total = (seconds('19m44') as number) + (seconds('32min20') as number)
    expect(formatSecondsToHHMMSS(total)).toBe('00:52:04')
  })

  it('1h59 + 1m30 = 2h00min30s (carrega minutos e segundos)', () => {
    const total = (seconds('1h59') as number) + (seconds('1m30') as number)
    expect(formatSecondsToHHMMSS(total)).toBe('02:00:30')
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
  it('é o texto de ajuda exato aprovado (inclui as formas 18h32/19m44/32min20)', () => {
    expect(DURATION_HELP_TEXT).toBe('Aceita 18:32, 18h32, 19m44, 32min20, 1h30min, 1,5h ou 90m.')
  })
})
