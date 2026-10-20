import { describe, expect, it } from 'vitest';
import { buildLeadEmail } from '../../src/leads/email';

const lead = {
  kind: 'pilot' as const,
  name: 'Ayesha Rahman',
  email: 'ayesha@example.edu',
  phone: '+880 1711 000000',
  institution: 'Example University',
  website: 'https://example.edu',
  role: null,
  country: null,
  size: null,
  message: 'We would like to pilot AI marking.\nSecond line.',
  sourcePage: '/pilot',
  createdAt: new Date('2026-10-20T00:00:00Z'),
};

describe('new-request alert email', () => {
  it('names the sender and institution in the subject and lists the details', () => {
    const m = buildLeadEmail(lead, 'https://api.scholametrix.tech');
    expect(m.subject).toBe('New free pilot request: Ayesha Rahman (Example University)');
    expect(m.text).toContain('Phone: +880 1711 000000');
    expect(m.text).toContain('Open in the console: https://api.scholametrix.tech/console/leads');
    expect(m.text).not.toContain('Role:');
  });

  it('escapes visitor text in the HTML body', () => {
    const m = buildLeadEmail({ ...lead, name: '<img src=x onerror=alert(1)>', message: '<script>alert(1)</script> & more' }, undefined);
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<img');
    expect(m.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more');
    expect(m.html).not.toContain('Open in the console');
  });

  it('keeps line breaks in a visitor name out of the subject header', () => {
    const m = buildLeadEmail({ ...lead, name: 'Eve\r\nBcc: attacker@example.com', institution: null }, undefined);
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toBe('New free pilot request: Eve Bcc: attacker@example.com');
  });
});
