'use client';

// Orbe de voz de la sala de práctica. No es un personaje ni un avatar inventado:
// indica en qué estado está la conversación (callada, escuchando, pensando o hablando).
// Los colores salen de los tokens de globals.css; aquí no hay ni un valor de color.
export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

// Etiquetas cortas: el orbe va al lado del texto que ya describe el estado, y un
// aria-label largo se confunde con el campo «Tu respuesta» al buscar por etiqueta.
const LABELS: Record<OrbState, string> = {
  idle: 'Voz en espera',
  listening: 'Escuchando',
  thinking: 'Pensando',
  speaking: 'Hablando',
};

export default function JarvisOrb({ state, size = 44, label }: { state: OrbState; size?: number; label?: string }) {
  return <span className="jarvis-orb" data-state={state} style={{ width: size, height: size }} role="img" aria-label={label ?? LABELS[state]}>
    <i className="jarvis-ring jarvis-ring-outer" aria-hidden="true" />
    <i className="jarvis-ring jarvis-ring-inner" aria-hidden="true" />
    <i className="jarvis-core" aria-hidden="true">
      <b /><b /><b /><b /><b />
    </i>
  </span>;
}
