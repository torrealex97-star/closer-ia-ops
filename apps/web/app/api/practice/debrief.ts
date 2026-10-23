import type { PracticeScenario } from '../../../components/practiceScenarios';
import { axesFor } from './prompts';
import type { PracticeTurn } from './signals';

export type PracticeAxis = { id: string; label: string; score: number; note: string; quote: string };

export type PracticeDebrief = {
  summary: string;
  focus: string;
  strengths: string[];
  improvements: string[];
  axes: PracticeAxis[];
  score: number;
  model: string;
  next: string;
  scenario: string;
};

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const clampScore = (input: unknown) => {
  const value = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
};

// El feedback se valida en servidor: sin ejes completos no hay nota, y una cita
// que no esté literalmente en la conversación se descarta. La puntuación global
// es la media de los cuatro ejes, no un número que el modelo pueda inventar.
export function cleanDebrief(raw: string, turns: PracticeTurn[], scenario: PracticeScenario): PracticeDebrief | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  const text = (input: unknown, max = 400) => typeof input === 'string' ? input.trim().slice(0, max) : '';
  const list = (input: unknown) => Array.isArray(input) ? input.map(item => text(item, 240)).filter(Boolean).slice(0, 3) : [];
  const student = turns.filter(turn => turn.role === 'user').map(turn => normalize(turn.content));

  const definitions = axesFor(scenario.kind);
  if (!Array.isArray(value.axes) || value.axes.length !== definitions.length) return null;
  const received = new Map<string, Record<string, unknown>>();
  for (const item of value.axes) {
    if (typeof item !== 'object' || item === null) return null;
    const axis = item as Record<string, unknown>;
    if (typeof axis.id !== 'string' || received.has(axis.id)) return null;
    received.set(axis.id, axis);
  }
  const axes: PracticeAxis[] = [];
  for (const definition of definitions) {
    const axis = received.get(definition.id);
    if (!axis) return null;
    const score = clampScore(axis.score);
    if (score === null) return null;
    const quote = text(axis.quote, 200);
    const needle = normalize(quote);
    // Una cita inventada se elimina; el eje y su nota se mantienen.
    const literal = needle.length >= 8 && student.some(line => line.includes(needle));
    axes.push({ id: definition.id, label: definition.label, score, note: text(axis.note, 300), quote: literal ? quote : '' });
  }

  const summary = text(value.summary, 500);
  const next = text(value.next, 300);
  if (!summary || !next) return null;
  const strengths = list(value.strengths);
  const improvements = list(value.improvements);
  const focus = text(value.focus, 240) || improvements[0] || '';
  const model = text(value.model, 600);
  const score = Math.round(axes.reduce((total, axis) => total + axis.score, 0) / axes.length);

  return { summary, focus, strengths, improvements, axes, score, model, next, scenario: scenario.title };
}
