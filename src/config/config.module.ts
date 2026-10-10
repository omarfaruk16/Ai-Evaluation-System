import { Global, Module } from '@nestjs/common';
import { validateEnv } from './env';

/** Injection token for the validated environment: `@Inject(ENV) env: Env`. */
export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => validateEnv(process.env) }],
  exports: [ENV],
})
export class AppConfigModule {}
