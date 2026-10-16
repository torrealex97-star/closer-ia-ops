// Extracción literal de compensación: node --experimental-strip-types tests/admin-auth/salary.mjs
import assert from 'node:assert/strict';
import { salaryFromText as f } from '../../apps/web/lib/salary.ts';

assert.equal(f('Salario: 24.000 - 30.000 € brutos/año + comisiones'), '24.000 - 30.000 € brutos/año');
assert.equal(f('Ofrecemos 1.800€ brutos al mes más incentivos'), '1.800€ brutos al mes');
assert.equal(f('Fijo de 30K€ anuales'), '30K€ anuales');
assert.equal(f('Entre 22000 y 28000 euros brutos anuales'), '22000 y 28000 euros brutos anuales');
assert.equal(f('Bonus de 1.000 € mensuales por objetivos'), null, 'bonus no es salario');
assert.equal(f('Comisiones de hasta 2.500 € al mes'), null, 'comisiones no es salario fijo');
assert.equal(f('Más de 2.000 clientes satisfechos'), null);
assert.equal(f('Inversión inicial de 5.000 € anuales'), null);
assert.equal(f('Pagamos 100 € al mes de transporte'), null, 'importes implausibles como sueldo');
assert.equal(f('Sueldo 24.000 € sin más datos'), null, 'sin periodo ni bruto/neto no se afirma');
assert.equal(f(null), null);
console.log('PASS  salario literal: 4 casos válidos y 6 descartes');
