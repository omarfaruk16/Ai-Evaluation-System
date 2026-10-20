import { Body, Controller, Get, HttpStatus, Inject, Injectable, Logger, Post, Put, UseGuards } from '@nestjs/common';
import type { Lead } from '@prisma/client';
import { createTransport } from 'nodemailer';
import { z } from 'zod';
import { AdminGuard } from '../admin/auth/admin.guard';
import { AppError } from '../common/errors';
import { open, seal } from '../common/secret-box';
import { parseOrThrow } from '../common/validation';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { SettingsService } from '../settings/settings.service';

const KEY = 'email.alerts';
const PURPOSE = 'email-alerts-smtp-password';

/** Stored in AppSetting. The SMTP password is only ever stored sealed. */
interface StoredSettings {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  passEnc: string;
  from: string;
  to: string;
}
const DEFAULTS: StoredSettings = { enabled: false, host: 'smtp.gmail.com', port: 587, user: '', passEnc: '', from: '', to: '' };

const KIND_LABEL: Record<Lead['kind'], string> = { pilot: 'Free pilot', demo: 'Demo', partner: 'Partner / sponsor', contact: 'Message' };

const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').trim();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Notice = Pick<Lead, 'kind' | 'name' | 'email' | 'phone' | 'institution' | 'website' | 'role' | 'country' | 'size' | 'message' | 'sourcePage' | 'createdAt'>;

/** The alert email for a new request. Visitor text is escaped and kept off the header lines. */
export function buildLeadEmail(lead: Notice, consoleUrl: string | undefined) {
  const kind = KIND_LABEL[lead.kind];
  const rows: [string, string | null][] = [
    ['Type', kind],
    ['Name', lead.name],
    ['Email', lead.email],
    ['Phone', lead.phone],
    ['Institution', lead.institution],
    ['Website', lead.website],
    ['Role', lead.role],
    ['Country', lead.country],
    ['Size', lead.size],
    ['Sent from', lead.sourcePage],
  ];
  const shown = rows.filter((r): r is [string, string] => !!r[1]);
  const link = consoleUrl ? `${consoleUrl.replace(/\/+$/, '')}/console/leads` : null;
  const text = [
    `New ${kind.toLowerCase()} request on scholametrix.tech`,
    '',
    ...shown.map(([k, v]) => `${k}: ${v}`),
    '',
    'Message:',
    lead.message,
    ...(link ? ['', `Open in the console: ${link}`] : []),
  ].join('\n');
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;color:#0b1533">
<h2 style="margin:0 0 4px;font-size:18px">New ${esc(kind.toLowerCase())} request</h2>
<p style="margin:0 0 16px;color:#55657f;font-size:13px">scholametrix.tech</p>
<table style="border-collapse:collapse;font-size:14px;width:100%">${shown
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#55657f;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0">${esc(v)}</td></tr>`)
    .join('')}</table>
<p style="margin:18px 0 6px;color:#55657f;font-size:13px">Message</p>
<div style="white-space:pre-wrap;background:#f5f8ff;border:1px solid #e3eaf8;border-radius:10px;padding:14px;font-size:14px;line-height:1.55">${esc(lead.message)}</div>
${link ? `<p style="margin:20px 0 0"><a href="${esc(link)}" style="background:#0164f3;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:600;font-size:14px">Open in the console</a></p>` : ''}
</div>`;
  const subject = oneLine(`New ${kind.toLowerCase()} request: ${lead.name}${lead.institution ? ` (${lead.institution})` : ''}`).slice(0, 150);
  return { subject, text, html };
}

@Injectable()
export class EmailAlertService {
  private readonly logger = new Logger(EmailAlertService.name);

  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private stored(): Promise<StoredSettings> {
    return this.settings.get<StoredSettings>(KEY, DEFAULTS);
  }

  /** What the console shows: never the password, only whether one is saved. */
  async view() {
    const s = await this.stored();
    return { enabled: s.enabled, host: s.host, port: s.port, user: s.user, from: s.from, to: s.to, passwordSet: !!s.passEnc, canStorePassword: !!this.env.SECRETS_ENCRYPTION_KEY };
  }

  async save(input: z.infer<typeof saveSchema>) {
    const cur = await this.stored();
    let passEnc = cur.passEnc;
    if (input.password) {
      if (!this.env.SECRETS_ENCRYPTION_KEY) {
        throw new AppError('conflict', 'SECRETS_ENCRYPTION_KEY is not set on the server, so the password can’t be stored safely.', HttpStatus.CONFLICT);
      }
      passEnc = seal(input.password, this.env.SECRETS_ENCRYPTION_KEY, PURPOSE);
    }
    const next: StoredSettings = { enabled: input.enabled, host: input.host, port: input.port, user: input.user, from: input.from || input.user, to: input.to, passEnc };
    if (next.enabled && (!next.host || !next.user || !next.passEnc || !next.to)) {
      throw new AppError('validation_failed', 'To switch alerts on, fill in the mail server, account, password and where to send alerts.', HttpStatus.BAD_REQUEST);
    }
    await this.settings.set(KEY, next);
    return this.view();
  }

  private transport(s: StoredSettings) {
    const pass = this.env.SECRETS_ENCRYPTION_KEY ? open(s.passEnc, this.env.SECRETS_ENCRYPTION_KEY, PURPOSE) : null;
    if (!pass) throw new AppError('conflict', 'The saved mail password can’t be read. Enter it again.', HttpStatus.CONFLICT);
    return createTransport({
      host: s.host,
      port: s.port,
      secure: s.port === 465,
      requireTLS: s.port !== 465,
      auth: { user: s.user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  /** Sends the alert for a new request. Never throws: a mail problem must not affect the visitor's form. */
  async notifyLead(lead: Notice): Promise<void> {
    try {
      const s = await this.stored();
      if (!s.enabled) return;
      const mail = buildLeadEmail(lead, this.env.PUBLIC_URL);
      await this.transport(s).sendMail({ from: s.from || s.user, to: s.to, replyTo: lead.email, ...mail });
    } catch (e) {
      this.logger.warn(`Lead alert email failed: ${(e as Error).message}`);
    }
  }

  /** Sends a sample alert so the settings can be checked. Throws with the mail server's reason. */
  async sendTest(): Promise<void> {
    const s = await this.stored();
    if (!s.host || !s.user || !s.passEnc || !s.to) {
      throw new AppError('validation_failed', 'Save the mail settings first.', HttpStatus.BAD_REQUEST);
    }
    const mail = buildLeadEmail(
      { kind: 'pilot', name: 'Test Visitor', email: 'visitor@example.edu', phone: '+880 1700 000000', institution: 'Example University', website: 'https://example.edu', role: null, country: 'Bangladesh', size: null, message: 'This is a test alert from the Scholametrix console. Real requests look like this.', sourcePage: '/pilot', createdAt: new Date() },
      this.env.PUBLIC_URL,
    );
    try {
      await this.transport(s).sendMail({ from: s.from || s.user, to: s.to, ...mail, subject: `[Test] ${mail.subject}` });
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('validation_failed', `The mail server refused it: ${(e as Error).message}`, HttpStatus.BAD_REQUEST);
    }
  }
}

const emailList = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || v.split(',').every((a) => z.string().email().safeParse(a.trim()).success), 'Enter email addresses separated by commas');

const saveSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(200),
  port: z.number().int().min(1).max(65535),
  user: z.string().trim().max(200),
  password: z.string().max(200).optional(),
  from: z.string().trim().max(200).default(''),
  to: emailList,
});

@Controller('admin-api/email-settings')
@UseGuards(AdminGuard)
export class EmailSettingsController {
  constructor(@Inject(EmailAlertService) private readonly email: EmailAlertService) {}

  @Get()
  get() {
    return this.email.view();
  }

  @Put()
  put(@Body() body: unknown) {
    return this.email.save(parseOrThrow(saveSchema, body));
  }

  @Post('test')
  async test() {
    await this.email.sendTest();
    return { ok: true };
  }
}
