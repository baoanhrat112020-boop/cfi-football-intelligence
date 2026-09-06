import { DATE_CONTEXT_POLICIES } from './daily-text-parser.mjs';
import { runDailySourceAdapter } from './run-daily-source-adapter.mjs';

await runDailySourceAdapter({
  providerKey: 'BONGDAWAP',
  dateContextPolicy: DATE_CONTEXT_POLICIES.EXPLICIT_TEXT_DATE_REQUIRED
});
