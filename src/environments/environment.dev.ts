import { NgxsLoggerPluginModule } from '@ngxs/logger-plugin';
import { AfterglowEnv } from './afterglow-env';

export const env: AfterglowEnv = {
  production: false,
  environment: 'DEV',
  version: '1.0.30',
  buildDate: 'Wednesday, June 25, 2025',
  coreVersion: 'v1',
  configUrl: 'afterglow.json',
  plugins: [NgxsLoggerPluginModule.forRoot()],
};
