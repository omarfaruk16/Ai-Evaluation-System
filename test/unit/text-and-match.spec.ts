import { describe, expect, it } from 'vitest';
import { canonicalAnswer, isBlankAnswer, roundToStep, stableJson } from '../../src/common/text';
import { locate } from '../../src/marking/match';

describe('text helpers', () => {
  it('normalises answers to NFC, unifies newlines and trims', () => {
    const decomposed = 'é'; // e + combining acute
    expect(canonicalAnswer(`  ${decomposed}\r\nx  `)).toBe('é\nx');
  });

  it('treats whitespace and punctuation only as blank', () => {
    expect(isBlankAnswer('   ')).toBe(true);
    expect(isBlankAnswer(' ... - ')).toBe(true);
    expect(isBlankAnswer('।')).toBe(true);
    expect(isBlankAnswer('TCP')).toBe(false);
    expect(isBlankAnswer('১')).toBe(false);
  });

  it('rounds to the mark step without floating noise', () => {
    expect(roundToStep(1.24, 0.5)).toBe(1);
    expect(roundToStep(1.26, 0.5)).toBe(1.5);
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundToStep(2.75, 0.25)).toBe(2.75);
  });

  it('produces stable JSON regardless of key order', () => {
    expect(stableJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
});

describe('locate', () => {
  const answer = 'TCP numbers every byte. The receiver sends an ACK back!';

  it('finds exact quotes', () => {
    expect(locate(answer, 'numbers every byte')).toEqual({ start: 4, end: 22 });
  });

  it('ignores case, extra spaces and surrounding punctuation', () => {
    const span = locate(answer, '"the RECEIVER   sends an ack back."');
    expect(span).not.toBeNull();
    expect(answer.slice(span!.start, span!.end)).toBe('The receiver sends an ACK back');
  });

  it('matches curly quotes and dashes against straight ones', () => {
    const text = "It's the sender's job - always.";
    const span = locate(text, 'sender’s job – always');
    expect(text.slice(span!.start, span!.end)).toBe("sender's job - always");
  });

  it('returns null for text that is not there', () => {
    expect(locate(answer, 'the network never loses packets')).toBeNull();
  });

  it('handles Bangla in either Unicode form', () => {
    // "অভিন্ন" vs a decomposed variant of the same visible text is normalised by NFC.
    const text = 'টিসিপি নির্ভরযোগ্য ডেটা পাঠায়। প্রতিটি বাইট নম্বর পায়।';
    const span = locate(text, 'প্রতিটি বাইট নম্বর পায়');
    expect(span).not.toBeNull();
    expect(text.slice(span!.start, span!.end)).toBe('প্রতিটি বাইট নম্বর পায়');
  });

  it('keeps offsets correct around characters outside the BMP', () => {
    const text = '🙂 Hello WORLD 🙂';
    const span = locate(text, 'hello world');
    expect(text.slice(span!.start, span!.end)).toBe('Hello WORLD');
  });

  it('searches from an offset for repeated phrases', () => {
    const text = 'ACK means ack. Another ACK.';
    const first = locate(text, 'ACK')!;
    const second = locate(text, 'ACK', first.end)!;
    expect(second.start).toBeGreaterThan(first.start);
  });
});
