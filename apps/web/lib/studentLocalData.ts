// Datos de la alumna que se guardan SOLO en este navegador (no en nuestro servidor). Claves fijas y sin espacio por
// cuenta, así que en un ordenador compartido las vería la siguiente persona: se borran al cerrar sesión y al
// «Borrar mi perfil» (el borrado del servidor no puede alcanzarlas).
export const STUDENT_LOCAL_KEYS = ['wdc_practice_history', 'wdc_training_precall', 'wdc_training_exam', 'wdc_saved_offers'] as const;

/** Quita del navegador todo lo que la alumna dejó en él. Sin almacenamiento disponible no hace nada. */
export function clearStudentLocalData(storage: Pick<Storage, 'removeItem'> | null = typeof window === 'undefined' ? null : safeStorage()): number {
  let removed = 0;
  for (const key of STUDENT_LOCAL_KEYS) { try { storage?.removeItem(key); removed++; } catch { /* sin almacenamiento */ } }
  return removed;
}
function safeStorage(): Storage | null { try { return window.localStorage; } catch { return null; } }
