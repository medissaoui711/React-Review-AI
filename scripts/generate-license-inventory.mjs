import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function buildLicenseInventory(lock) {
  if (!lock || typeof lock.packages !== 'object' || lock.packages === null) {
    throw new Error('package-lock.json must contain a packages object.');
  }
  const packages = Object.entries(lock.packages)
    .filter(([packagePath]) => packagePath.startsWith('node_modules/'))
    .map(([packagePath, item]) => ({
      package: item.name || packagePath.slice('node_modules/'.length),
      version: item.version || null,
      license: item.license ?? 'UNKNOWN',
      path: packagePath
    }))
    .sort((a, b) => a.package.localeCompare(b.package) || String(a.version).localeCompare(String(b.version)));
  return {
    generated_at: new Date().toISOString(),
    source: 'package-lock.json',
    package_count: packages.length,
    unknown_license_count: packages.filter(item => item.license === 'UNKNOWN').length,
    packages
  };
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const inventory = buildLicenseInventory(lock);
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/license-inventory.json', JSON.stringify(inventory, null, 2) + '\n');
  console.log('Inventoried ' + inventory.package_count + ' locked packages; '
    + inventory.unknown_license_count + ' have no declared license metadata.');
}
