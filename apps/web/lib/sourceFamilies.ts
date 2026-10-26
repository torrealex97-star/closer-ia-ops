// El motor recoge por CONECTOR («himalayas-closer», «freehire-latam-closer», «jobtoday-vendedor»…) y el
// catálogo nombra PORTALES («himalayas», «freehire», «jobtoday»). Cruzarlos por código exacto hacía que el
// panel enseñara «Himalayas · Fuera del cloud» mientras el motor la estaba recogiendo: una fuente conectada
// que se lee como apagada. Aquí se agrupan los conectores por su portal y se suman sus cifras.
export type CloudRow = { code: string; name: string; run_status: string | null; fetched: number | null; catalog: number; eligible: number; selected: number; warning: string | null };
export type FamilyRow = CloudRow & { connectors: number; connectors_detail: Array<{ code: string; run_status: string | null; fetched: number | null }> };

// Portales con varios conectores: el código del motor empieza por el del catálogo.
const BASES = ['jobtoday', 'freehire', 'himalayas', 'getonbrd'];

export const catalogCodeFor = (code: string): string => BASES.find(b => code === b || code.startsWith(`${b}-`)) ?? code;

// Un conector caído no se diluye en un «completada»: el estado del portal es el peor de sus conectores.
const SEVERITY: Record<string, number> = { failed: 5, deferred: 4, running: 3, queued: 2, completed: 1 };
const worst = (a: string | null, b: string | null) => ((SEVERITY[b ?? ''] ?? 0) > (SEVERITY[a ?? ''] ?? 0) ? b : a);

export function groupByFamily(rows: CloudRow[]): Map<string, FamilyRow> {
  const out = new Map<string, FamilyRow>();
  for (const row of rows) {
    const code = catalogCodeFor(row.code);
    const seen = out.get(code);
    if (!seen) {
      out.set(code, { ...row, code, connectors: 1, connectors_detail: [{ code: row.code, run_status: row.run_status, fetched: row.fetched }] });
      continue;
    }
    const fetched = seen.fetched === null || row.fetched === null ? (seen.fetched ?? row.fetched) : seen.fetched + row.fetched;
    out.set(code, {
      ...seen,
      // El nombre del portal es el del catálogo; el del conector se conserva en el detalle.
      name: seen.name,
      run_status: worst(seen.run_status, row.run_status),
      fetched,
      catalog: seen.catalog + row.catalog,
      eligible: seen.eligible + row.eligible,
      selected: seen.selected + row.selected,
      warning: [seen.warning, row.warning].filter(Boolean).join(' · ') || null,
      connectors: seen.connectors + 1,
      connectors_detail: [...seen.connectors_detail, { code: row.code, run_status: row.run_status, fetched: row.fetched }],
    });
  }
  return out;
}
