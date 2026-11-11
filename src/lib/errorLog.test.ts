import { appendEntry, formatErrorLog, MAX_ENTRIES, parseLog, redact, toEntry, type ErrorEntry } from './errorLog';

const entry = (message: string, source = 'sync', at = 1): ErrorEntry => ({ at, source, message, stack: null, count: 1 });

describe('redact', () => {
  it('hides bearer tokens', () => {
    expect(redact('Authorization: Bearer BQDa1b2c3d4e5f6g7h8')).toBe('Authorization: Bearer ***');
  });

  it('hides tokens in JSON and query strings', () => {
    expect(redact('{"access_token":"BQDa1b2c3d4e5f6","expires_in":3600}')).toBe('{"access_token":"***","expires_in":3600}');
    expect(redact('refresh_token=AQC1234567890abcdef&x=1')).toBe('refresh_token=***&x=1');
  });

  it('hides email addresses', () => {
    expect(redact('account mario.rossi+test@example.co.uk not enabled')).toBe('account ***@*** not enabled');
  });

  it('leaves ordinary text alone', () => {
    expect(redact('Spotify API 429: rate limited')).toBe('Spotify API 429: rate limited');
  });
});

describe('toEntry', () => {
  it('keeps the name, message and stack of an Error', () => {
    const e = toEntry(new TypeError('boom'), 'screen', 42);
    expect(e).toMatchObject({ at: 42, source: 'screen', message: 'TypeError: boom', count: 1 });
    expect(e.stack).toContain('boom');
  });

  it('accepts strings and other values', () => {
    expect(toEntry('plain text', 'sync').message).toBe('plain text');
    expect(toEntry({ code: 7 }, 'sync').message).toBe('{"code":7}');
    expect(toEntry(undefined, 'sync').message).toBe('undefined');
  });

  it('redacts and shortens what it stores', () => {
    const e = toEntry(new Error(`Bearer ${'x'.repeat(40)} ${'y'.repeat(2000)}`), 'sync');
    expect(e.message).toContain('Bearer ***');
    expect(e.message.length).toBeLessThanOrEqual(500);
  });
});

describe('appendEntry', () => {
  it('adds new errors at the end', () => {
    expect(appendEntry([entry('a')], entry('b')).map((e) => e.message)).toEqual(['a', 'b']);
  });

  it('counts the same error repeated in a row instead of duplicating it', () => {
    const log = appendEntry(appendEntry([entry('a', 'sync', 1)], entry('a', 'sync', 2)), entry('a', 'sync', 3));
    expect(log).toEqual([{ at: 3, source: 'sync', message: 'a', stack: null, count: 3 }]);
  });

  it('treats the same message from another source as a different error', () => {
    expect(appendEntry([entry('a', 'sync')], entry('a', 'screen'))).toHaveLength(2);
  });

  it('keeps only the most recent entries', () => {
    let log: ErrorEntry[] = [];
    for (let i = 0; i < MAX_ENTRIES + 10; i++) log = appendEntry(log, entry(`error ${i}`));
    expect(log).toHaveLength(MAX_ENTRIES);
    expect(log[0].message).toBe('error 10');
    expect(log[log.length - 1].message).toBe(`error ${MAX_ENTRIES + 9}`);
  });
});

describe('parseLog', () => {
  it('reads back what was written', () => {
    const log = [entry('a'), entry('b')];
    expect(parseLog(JSON.stringify(log))).toEqual(log);
  });

  it('survives a missing or damaged file', () => {
    expect(parseLog(null)).toEqual([]);
    expect(parseLog('')).toEqual([]);
    expect(parseLog('{not json')).toEqual([]);
    expect(parseLog('{"a":1}')).toEqual([]);
    expect(parseLog('[null, 3, {"message":"ok"}]')).toEqual([{ message: 'ok' }]);
  });
});

describe('formatErrorLog', () => {
  it('puts the newest error first and shows repetitions', () => {
    const text = formatErrorLog([entry('older', 'sync', 1000), { ...entry('newer', 'crash', 2000), count: 4, stack: 'at line 1' }]);
    expect(text.indexOf('newer')).toBeLessThan(text.indexOf('older'));
    expect(text).toContain('crash (×4)');
    expect(text).toContain('at line 1');
    expect(text.startsWith('Soundtrace')).toBe(true);
  });

  it('says so when the log is empty', () => {
    expect(formatErrorLog([])).toContain('—');
  });
});
