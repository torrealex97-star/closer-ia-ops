import { ORG } from './external';
import { withdrawalReason } from './autoReview';
import { pagedRest } from './supabaseAuth';

// Auditoría del catálogo: qué ofertas YA aprobadas (y vivas) retiraría hoy la regla, y por qué. Es SOLO
// LECTURA —no cambia ninguna fila ni gasta cupo de aprobaciones—. Hace falta porque la pasada automática solo
// mira borradores: lo que aprobó una versión anterior de la regla (o una persona) sigue delante de las alumnas
// hasta que alguien lo retira. Así se ve antes de decidir, y sin que un barrido borre ofertas publicadas.
export const AUDIT_MAX = 2000;
const PAGE = 500;
// Columnas mínimas para `withdrawalReason`. Si esa función empieza a mirar otro campo, hay que traerlo aquí:
// el tipo `Retirable` del motivo obliga a actualizarlo, y esta consulta es el único sitio que lo alimenta.
const SELECT = 'id,source,title,company,url,editorial_status,verified_result,reviewed_by,score';

export type RuleAuditMatch = {
  id: string; source: string; title: string; company: string | null; url: string;
  editorial_status: string; verified_result: string | null; reviewed_by: string | null; score: number | null;
  /** Motivo de la regla: `no_es_oferta` (listado de portal) o `enlace_cerrado`. */
  why: string;
};

export type RuleAudit = {
  /** Ofertas aprobadas y vivas que se llegaron a mirar. */
  scanned: number;
  matches: RuleAuditMatch[];
  by_reason: Record<string, number>;
  /** Se alcanzó el tope y quedan ofertas sin mirar: la lista NO está completa. */
  truncated: boolean;
};

/** Lee el catálogo vivo en páginas y aplica el criterio de retirada de las reglas. `null` si la lectura falla. */
export async function auditApprovedByRules(max = AUDIT_MAX): Promise<RuleAudit | null> {
  if (!Number.isFinite(max) || max < 1) return null;
  const now = encodeURIComponent(new Date().toISOString());
  // Mismo paginador que el resto del panel: una página corta no prueba que no haya más, y un fallo devuelve null
  // (nunca una lista parcial disfrazada de completa).
  const page = await pagedRest<RuleAuditMatch>(`external_offers?org_id=eq.${ORG}&editorial_status=in.(approved,published)&expires_at=gt.${now}&select=${SELECT}`, 'id.asc', max, PAGE);
  if (!page) return null;
  const matches: RuleAuditMatch[] = [];
  const by_reason: Record<string, number> = {};
  for (const row of page.rows) {
    const why = withdrawalReason(row);
    if (!why) continue;
    by_reason[why] = (by_reason[why] ?? 0) + 1;
    matches.push({ ...row, why });
  }
  return { scanned: page.rows.length, matches, by_reason, truncated: page.truncated };
}
