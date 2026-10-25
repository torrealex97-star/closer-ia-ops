'use client';

import { logActivity } from './studentActivityClient';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, Clock3, Gauge, LoaderCircle, MessageSquare, Mic, MicOff, Play, Quote, RotateCcw, Send, Sparkles, Target, Volume2 } from 'lucide-react';
import { INTENSITY_LABELS, PRACTICE_SCENARIOS, scenarioById } from './practiceScenarios';
import type { PracticeScenario } from './practiceScenarios';
import JarvisOrb from './JarvisOrb';
import type { OrbState } from './JarvisOrb';
import { useVoiceInput } from './useVoiceInput';

type Turn = { role: 'user' | 'coach'; content: string };
type Axis = { id: string; label: string; score: number; note: string; quote: string };
type Signal = { id: string; label: string; detail: string; quote: string };
type Debrief = {
  summary: string;
  focus?: string;
  strengths: string[];
  improvements: string[];
  // Las prácticas anteriores al método guardaban solo momentos citados.
  moments?: { quote: string; why: string }[];
  axes?: Axis[];
  score?: number;
  signals?: Signal[];
  model?: string;
  next: string;
  scenario?: string;
};

const band = (score: number) => score >= 70 ? 'alto' : score >= 40 ? 'medio' : 'bajo';
type Stored = { id: string; scenarioId: string; title: string; startedAt: number; turns: number; debrief: Debrief };
type View = 'scenarios' | 'room' | 'debrief';

const HISTORY_KEY = 'wdc_practice_history';
// La ruta acepta 24 turnos por petición. La sala corta antes para que el feedback
// siempre quepa: sin este tope, una conversación larga acababa en 422 y no había
// forma de cerrarla ni de recibir nota.
const TURN_LIMIT = 20;
const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const when = (value: number) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

function Bubble({ turn, onSpeak }: { turn: Turn; onSpeak?: (text: string) => void }) {
  const mine = turn.role === 'user';
  return <div className={`practice-turn ${mine ? 'is-mine' : 'is-them'}`}>
    <div className="practice-bubble">
      <p>{turn.content}</p>
      {!mine && onSpeak && <button type="button" className="speak" onClick={() => onSpeak(turn.content)}><Volume2 size={13} />Escuchar</button>}
    </div>
  </div>;
}

// Sala de práctica: simulacro de venta o entrevista con feedback. Todo es ficticio y
// se dice; el feedback cita solo frases literales de la alumna (validadas en servidor).
export default function StudentPractice() {
  const [view, setView] = useState<View>('scenarios');
  const [scenario, setScenario] = useState<PracticeScenario | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [history, setHistory] = useState<Stored[]>([]);
  const [canSpeak, setCanSpeak] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  // Dictado del navegador: lo que se reconoce se añade al borrador, nunca se envía solo.
  const voice = useVoiceInput(text => setDraft(current => current.trim() ? `${current.trimEnd()} ${text}` : text));
  const chat = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]');
      if (Array.isArray(stored)) setHistory(stored.filter((item): item is Stored => Boolean(item?.id && item?.title)));
    } catch { /* almacenamiento no disponible: la práctica sigue funcionando sin historial */ }
    setCanSpeak(typeof window !== 'undefined' && 'speechSynthesis' in window);
  }, []);
  useEffect(() => {
    if (view !== 'room') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [view]);
  useEffect(() => {
    chat.current?.scrollTo({ top: chat.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  const studentTurns = useMemo(() => turns.filter(turn => turn.role === 'user').length, [turns]);
  const elapsed = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const atLimit = turns.length >= TURN_LIMIT;
  const orb: OrbState = voice.listening ? 'listening' : busy ? 'thinking' : speaking ? 'speaking' : 'idle';

  function saveHistory(next: Stored[]) {
    setHistory(next);
    try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, 8))); } catch { /* sin historial */ }
  }
  function speak(text: string) {
    if (!canSpeak) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }
  function begin(item: PracticeScenario) {
    setError('');
    setScenario(item);
    setTurns([{ role: 'coach', content: item.opening }]);
    setDebrief(null);
    setDraft('');
    setStartedAt(Date.now());
    setNow(Date.now());
    setView('room');
  }
  async function post(body: Record<string, unknown>) {
    const response = await fetch('/api/practice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as { detail?: string };
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se ha podido completar la práctica.');
    return data as { reply?: string; debrief?: Debrief };
  }
  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !scenario || busy || turns.length >= TURN_LIMIT) return;
    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next); setDraft(''); setBusy(true); setError('');
    try {
      const data = await post({ scenario: scenario.id, messages: next, mode: 'reply' });
      setTurns(current => [...current, { role: 'coach', content: String(data.reply ?? '').trim() || 'No he recibido respuesta. Vuelve a intentarlo.' }]);
    } catch (exception) {
      setError((exception as Error).message);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => composer.current?.focus());
    }
  }
  async function finish() {
    if (!scenario || busy) return;
    setBusy(true); setError('');
    try {
      const data = await post({ scenario: scenario.id, messages: turns, mode: 'debrief' });
      if (!data.debrief) throw new Error('No se ha recibido feedback. Vuelve a intentarlo.');
      setDebrief(data.debrief);
      setView('debrief');
      // Alimenta «Mi progreso» (solo con sesión; sin ella la práctica sigue igual). Se guarda la nota y la de cada eje, no el texto.
      if (typeof data.debrief.score === 'number') void logActivity({ kind: 'practice', ref: scenario.id, score: Math.max(0, Math.min(100, Math.round(data.debrief.score))), detail: { mode: 'texto', axes: Object.fromEntries((data.debrief.axes ?? []).map(axis => [axis.id, Math.max(0, Math.min(100, Math.round(axis.score)))])) } });
      saveHistory([{ id: crypto.randomUUID?.() ?? String(Date.now()), scenarioId: scenario.id, title: scenario.title, startedAt, turns: studentTurns, debrief: data.debrief }, ...history]);
    } catch (exception) {
      setError((exception as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (view === 'room' && scenario) {
    return <section className="practice practice-room">
      <div className="practice-room-head">
        <button className="practice-back" type="button" onClick={() => { setView('scenarios'); setScenario(null); setTurns([]); }}><ArrowLeft size={16} />Salir</button>
        <div>
          <span className="eyebrow">SIMULACRO · {scenario.kind === 'venta' ? 'VENTA' : 'ENTREVISTA'} · {INTENSITY_LABELS[scenario.intensity].toUpperCase()}</span>
          <h1>{scenario.title}</h1>
          <p>{scenario.context}</p>
        </div>
        <div className="practice-clock" aria-label={`Tiempo de práctica: ${clock(elapsed)}`}><Clock3 size={15} /><span>{clock(elapsed)}</span></div>
      </div>
      <div className="practice-grid">
        <div className="practice-chat">
          <div className="practice-chat-head"><span className="practice-avatar" aria-hidden="true"><MessageSquare size={16} /></span><div><strong>Interlocutor</strong><small>Simulación · empresa ficticia</small></div><div className="practice-voice"><JarvisOrb state={orb} /><small>{orb === 'listening' ? 'Te escucho' : orb === 'thinking' ? 'Pensando' : orb === 'speaking' ? 'Hablando' : 'Voz en espera'}</small></div></div>
          <div className="practice-body" ref={chat} aria-live="polite">
            {turns.map((turn, index) => <Bubble key={`${index}-${turn.role}`} turn={turn} onSpeak={canSpeak && turn.role === 'coach' ? speak : undefined} />)}
            {busy && <div className="practice-turn is-them"><div className="practice-bubble is-typing" aria-label="El interlocutor está escribiendo"><i /><i /><i /></div></div>}
          </div>
          {error && <p className="practice-error" role="alert"><CircleAlert size={15} />{error}</p>}
          {voice.error && <p className="practice-error" role="alert"><CircleAlert size={15} />{voice.error}</p>}
          <form className="practice-composer" onSubmit={send}>
            <label htmlFor="practice-reply" className="sr-only">Tu respuesta</label>
            {voice.supported && <button type="button" className="practice-mic" data-listening={voice.listening} aria-pressed={voice.listening} onClick={() => voice.listening ? voice.stop() : voice.start()} disabled={busy || atLimit} aria-label={voice.listening ? 'Parar el dictado' : 'Dictar la respuesta'} title={voice.listening ? 'Parar el dictado' : 'Dictar la respuesta'}>{voice.listening ? <MicOff size={17} /> : <Mic size={17} />}</button>}
            <textarea ref={composer} id="practice-reply" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) void send(event); }} placeholder={atLimit ? 'La conversación ha llegado a su final.' : voice.interim || 'Responde como lo dirías en la conversación real…'} rows={2} maxLength={800} disabled={busy || atLimit} />
            <button className="primary" type="submit" disabled={busy || atLimit || !draft.trim()} aria-label="Enviar respuesta">{busy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}Enviar</button>
          </form>
          <div className="practice-finish">
            <button type="button" onClick={() => void finish()} disabled={busy || studentTurns < 2}><Sparkles size={16} />Terminar y ver feedback</button>
            <small>{atLimit ? 'Habéis llegado al final de la simulación: pide el feedback para cerrar la práctica.' : studentTurns < 2 ? 'Responde al menos dos veces para recibir feedback.' : 'El feedback cita solo lo que has escrito.'}</small>
          </div>
        </div>
        <aside className="practice-aside">
          <h2>Lo que practicas</h2>
          <ol>{scenario.objectives.map(objective => <li key={objective}>{objective}</li>)}</ol>
          <div className="practice-hint"><MessageSquare size={16} /><p>Escribe como hablarías: frases cortas, una pregunta cada vez. El interlocutor no conoce tu CV.</p></div>
          <div className="practice-hint"><Target size={16} /><p>No hay respuestas perfectas. Si te bloqueas, pide contexto o propón un siguiente paso.</p></div>
          <p className="practice-note">Empresa y personas son ficticias. Esta práctica no envía nada a ninguna empresa.</p>
        </aside>
      </div>
    </section>;
  }

  if (view === 'debrief' && debrief) {
    return <section className="practice practice-debrief">
      <button className="practice-back" type="button" onClick={() => { setView('scenarios'); setScenario(null); setDebrief(null); }}><ArrowLeft size={16} />Volver a las situaciones</button>
      <span className="eyebrow">FEEDBACK DE PRÁCTICA</span>
      <h1>Qué ha funcionado y qué pulir.</h1>
      <p className="practice-summary">{debrief.summary}</p>
      {typeof debrief.score === 'number' && debrief.axes?.length ? <div className="practice-score">
        <div className="practice-score-total" data-band={band(debrief.score)}>
          <Gauge size={16} />
          <b>{debrief.score}</b>
          <span>/100</span>
          <small>estimación</small>
        </div>
        <div className="practice-score-detail">
          <div className="practice-score-head"><h2>{debrief.axes.length === 4 ? 'Los cuatro ejes' : `Los ${debrief.axes.length} criterios`}</h2><small>{scenario?.rubric === 'wdc-entrevista' ? 'Media ponderada según la rúbrica.' : 'Media de ejes.'} No es una nota oficial.</small></div>
          <dl className="practice-axes">
            {debrief.axes.map(axis => <div className="practice-axis" key={axis.id}>
              <dt><span>{axis.label}</span><b data-band={band(axis.score)}>{axis.score}</b></dt>
              <div className="practice-bar" role="meter" aria-valuenow={axis.score} aria-valuemin={0} aria-valuemax={100} aria-label={`${axis.label}: ${axis.score} de 100`}><i data-band={band(axis.score)} style={{ width: `${axis.score}%` }} /></div>
              {axis.note && <dd>{axis.note}</dd>}
              {axis.quote && <blockquote>«{axis.quote}»</blockquote>}
            </div>)}
          </dl>
        </div>
      </div> : null}
      {debrief.focus && <div className="practice-focus"><span className="eyebrow">LO QUE MÁS TE HA FRENADO</span><p>{debrief.focus}</p></div>}
      <div className="practice-columns">
        <div><h2><Check size={17} />Qué has hecho bien</h2><ul>{debrief.strengths.map(item => <li key={item}>{item}</li>)}</ul></div>
        <div><h2><Target size={17} />Qué pulir</h2><ul>{debrief.improvements.map(item => <li key={item}>{item}</li>)}</ul></div>
      </div>
      {debrief.signals?.length ? <div className="practice-signals">
        <h2><Gauge size={17} />Señales de estilo</h2>
        <p className="practice-signals-note">Calculadas sobre tus mensajes, sin IA. Son observaciones, no una nota.</p>
        <ul>{debrief.signals.map(signal => <li key={signal.id}>
          <strong>{signal.label}</strong>
          <p>{signal.detail}</p>
          {signal.quote && <blockquote>«{signal.quote}»</blockquote>}
        </li>)}</ul>
      </div> : null}
      {debrief.model && <div className="practice-model"><span className="eyebrow">CÓMO PODRÍA SONAR</span><p>{debrief.model}</p><small>Una forma posible con tus propias palabras. No es la única respuesta.</small></div>}
      {!debrief.axes?.length && debrief.moments?.length ? <div className="practice-moments">
        <h2><Quote size={17} />Momentos de la conversación</h2>
        {debrief.moments.map(moment => <figure key={moment.quote}><blockquote>«{moment.quote}»</blockquote><figcaption>{moment.why}</figcaption></figure>)}
      </div> : null}
      <div className="practice-next"><span className="eyebrow">SIGUIENTE PRÁCTICA</span><p>{debrief.next}</p></div>
      <div className="practice-actions">
        <button type="button" onClick={() => scenario && begin(scenario)}><RotateCcw size={16} />Repetir esta situación</button>
        <button className="primary" type="button" onClick={() => { setView('scenarios'); setScenario(null); setDebrief(null); }}>Elegir otra situación<ArrowRight size={16} /></button>
      </div>
      <p className="practice-note">El feedback y la puntuación los estima un modelo de IA a partir de tu conversación; la puntuación no es una nota oficial. Es un simulacro: no evalúa tu candidatura ni decide nada sobre ningún proceso. Tu texto se envía a un proveedor de IA: no escribas datos personales de terceros (<a href="/privacidad">Privacidad</a> · <a href="/terminos">Términos</a>).</p>
    </section>;
  }

  return <section className="practice">
    <div className="practice-head">
      <div>
        <span className="eyebrow">PRÁCTICA DE CONVERSACIÓN</span>
        <h1>Ensaya la conversación antes de la real.</h1>
        <p>Elige una situación, habla con un interlocutor simulado y recibe feedback sobre lo que has dicho. Empresas y personas son ficticias.</p>
      </div>
      <span className="practice-icon"><MessageSquare size={26} strokeWidth={1.4} /></span>
    </div>
    {error && <p className="practice-error" role="alert"><CircleAlert size={15} />{error}</p>}
    <div className="practice-scenarios">
      {PRACTICE_SCENARIOS.map(item => <article className="practice-card" key={item.id}>
        <div className="practice-card-top"><span className={`practice-kind ${item.kind}`}>{item.kind === 'venta' ? 'Venta' : 'Entrevista'}</span><span className="practice-card-meta"><span className="practice-level" data-intensity={item.intensity}>{INTENSITY_LABELS[item.intensity]}</span><span className="practice-minutes"><Clock3 size={13} />{item.minutes} min</span></span></div>
        <h2>{item.title}</h2>
        <p className="practice-context">{item.context}</p>
        <p>{item.summary}</p>
        <ul>{item.objectives.map(objective => <li key={objective}>{objective}</li>)}</ul>
        <div className="practice-card-foot"><span>{item.level}</span><button className="primary" type="button" onClick={() => begin(item)}><Play size={15} />Practicar</button></div>
      </article>)}
    </div>
    {history.length > 0 && <div className="practice-history">
      <h2>Tus últimas prácticas</h2>
      <ul>{history.map(entry => <li key={entry.id}>
        <div><strong>{entry.title}</strong><small>{when(entry.startedAt)} · {entry.turns} respuestas</small><p>{entry.debrief.summary}</p></div>
        {typeof entry.debrief.score === 'number' && <span className="practice-history-score" data-band={band(entry.debrief.score)}>{entry.debrief.score}<small>/100</small></span>}
        <button type="button" onClick={() => { setScenario(scenarioById(entry.scenarioId)); setDebrief(entry.debrief); setView('debrief'); }}>Ver feedback</button>
      </li>)}</ul>
    </div>}
    <p className="practice-note">La sala de práctica es un simulacro formativo. No se envía nada a empresas y no sustituye a una entrevista real. Lo que escribes (o dices) se envía a un proveedor de inteligencia artificial para simular la conversación: no escribas datos personales de terceros. Más en <a href="/privacidad">Privacidad</a> y <a href="/terminos">Términos</a>.</p>
  </section>;
}
