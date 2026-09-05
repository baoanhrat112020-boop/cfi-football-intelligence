import { assertShadowEnvironment } from './config.mjs';
import { HF_SHADOW_VERSION, SHADOW_FLAGS } from './contracts.mjs';

assertShadowEnvironment();
if (SHADOW_FLAGS.production_mutation !== false || SHADOW_FLAGS.shadow_only !== true) throw new Error('SHADOW_FLAGS_INVALID');
process.stdout.write(`${JSON.stringify({ status: 'PASS', version: HF_SHADOW_VERSION, ...SHADOW_FLAGS })}\n`);
