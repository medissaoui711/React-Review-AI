import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLicenseInventory } from '../scripts/generate-license-inventory.mjs';

test('license inventory is deterministic and marks missing licenses unknown', () => {
  const lock = {
    packages: {
      '': { name: 'react-review-ai-mcp-server', version: '0.6.0' },
      'node_modules/zeta': { name: 'zeta', version: '2.0.0', license: 'Apache-2.0' },
      'node_modules/@scope/alpha': { name: '@scope/alpha', version: '1.1.0', license: 'MIT' },
      'node_modules/unknown': { name: 'unknown', version: '3.0.0' }
    }
  };
  const first = buildLicenseInventory(lock);
  const second = buildLicenseInventory(lock);

  assert.deepEqual(first, second);
  assert.deepEqual(first.packages.map(item => item.package), ['@scope/alpha', 'unknown', 'zeta']);
  assert.equal(first.package_count, 3);
  assert.equal(first.unknown_license_count, 1);
  assert.equal(first.packages[1].license, 'UNKNOWN');
});

test('license inventory rejects malformed lockfile data', () => {
  assert.throws(() => buildLicenseInventory({}), /packages object/);
});
