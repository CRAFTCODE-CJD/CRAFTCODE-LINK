'use strict';

// Only the explicit offline test launcher opens the synthetic-media harness.
if (process.argv.includes('--craftlink-test-media')) {
  require('../tests/qa-main.cjs');
} else {
  require('./main.cjs');
}
