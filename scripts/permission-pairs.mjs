// Prints the expected role→permission pairs (one per line) for the SQL test harness.
import { ROLE_PERMISSION_PAIRS } from '../shared/permissions.js';

process.stdout.write(ROLE_PERMISSION_PAIRS.join('\n') + '\n');
