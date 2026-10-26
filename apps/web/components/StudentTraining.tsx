'use client';

import { logActivity } from './studentActivityClient';
import { useEffect, useMemo, useState, type ComponentType, type FormEvent } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Award, Brain, Calculator, Check, CheckCircle2,
  CircleAlert, Clock3, Flag, GraduationCap, Heart, MessageSquare, RotateCcw, ShieldAlert,
  Sparkles, Target, TrendingUp, X, Zap,
} from 'lucide-react';
import {
  BELIEF_LADDER, CERTIFICATION_WEEKS, CLOSE_BANK, DISCOVERY_BANK, DISCOVERY_STEPS, EXACT_CLOSES, FINAL_EXAM, FREEZING, IDENTITY_FRAMES, LOGICA,
  INTERVIEW_QUESTIONS, PRE_CALL_STEPS, SHOW_RATE_RULES, STAR_CRITERIA, STAR_RULE, TRAINING_MODULES,
  YELLOW_LEADS, YELLOW_RULE,
} from './trainingContent';
import type { BankQuestion, TrainingId } from './trainingContent';
import {
  EXAM_PASS, YELLOW_BLOCK, freezingFalls, gradeBank, gradeExam, moralFor, reviewCloseLine,
  reviewFreezing, reviewInterviewAnswer, reviewLogica, reviewPreCall, reviewYellows, yellowMistakes,
} from './trainingCheck';
import type { Review } from './trainingCheck';

const PRECALL_KEY = 'wdc_training_precall';
const EXAM_KEY = 'wdc_training_exam';
type ExamStored = { score: number; total: number; passed: boolean; at: number };

function readExam(): ExamStored | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(EXAM_KEY) ?? 'null') as ExamStored | null;
    return value && typeof value.score === 'number' && typeof value.total === 'number' ? value : null;
  } catch { return null; /* sin historial del examen */ }
}

function cleanReview(value: unknown): Review | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Review;
  if (!Array.isArray(candidate.criteria) || typeof candidate.met !== 'number' || typeof candidate.total !== 'number') return null;
  return candidate;
}

// Un ejercicio está completo solo cuando hay revisión y cumple todos sus criterios.
const complete = (review: Review | null) => Boolean(review && review.met === review.total);

function Criteria({ review }: { review: Review }) {
  return <ul className="training-criteria">{review.criteria.map(item => <li key={item.id} data-ok={item.ok}>
    {item.ok ? <Check size={14} /> : <CircleAlert size={14} />}
    <span>{item.detail}</span>
  </li>)}</ul>;
}

function Outcome({ review, title, note }: { review: Review; title: string; note: string }) {
  const all = review.met === review.total;
  return <div className="training-outcome" data-done={all}>
    <div className="training-outcome-head"><CheckCircle2 size={16} /><h3>{title}</h3><b>{review.met}/{review.total}</b></div>
    <Criteria review={review} />
    <p className="training-note">{note}</p>
  </div>;
}

// ---- Módulo 1: pre-llamada --------------------------------------------------

function PreCall() {
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<string[]>(() => PRE_CALL_STEPS.map(() => ''));
  const [reviews, setReviews] = useState<(Review | null)[]>(() => PRE_CALL_STEPS.map(() => null));
  const step = PRE_CALL_STEPS[index];
  const draft = drafts[index];

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(PRECALL_KEY) ?? 'null') as { drafts?: unknown; reviews?: unknown } | null;
      const drafts = stored?.drafts;
      const reviews = stored?.reviews;
      if (Array.isArray(drafts) && drafts.every(item => typeof item === 'string')) {
        setDrafts(PRE_CALL_STEPS.map((_, i) => String(drafts[i] ?? '')));
      }
      if (Array.isArray(reviews) && reviews.length === PRE_CALL_STEPS.length) {
        setReviews(reviews.map(cleanReview));
      }
    } catch { /* sin almacenamiento: los mensajes viven solo en esta visita */ }
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(PRECALL_KEY, JSON.stringify({ drafts, reviews })); } catch { /* sin almacenamiento */ }
  }, [drafts, reviews]);

  function edit(value: string) {
    setDrafts(current => current.map((item, i) => i === index ? value : item));
    setReviews(current => current.map((item, i) => i === index ? null : item));
  }
  function check() {
    const result = reviewPreCall(step.id, draft);
    setReviews(current => current.map((item, i) => i === index ? result : item));
    void logActivity({ kind: 'training_review', ref: 'precall', detail: { met: result.met, total: result.total } });
  }
  const review = reviews[index];
  const done = reviews.filter(complete).length;

  return <div className="training-module">
    <div className="training-intro">
      <Clock3 size={18} />
      <div><h2>Pre-llamada y show-rate</h2><p>La conversación empieza días antes. Escribe el mensaje de cada momento y revísalo contra los criterios del método.</p></div>
      <span className="training-count">{done} de {PRE_CALL_STEPS.length} completos</span>
    </div>
    <ol className="training-steps" aria-label="Momentos de la secuencia">
      {PRE_CALL_STEPS.map((item, i) => <li key={item.id}>
        <button type="button" className="training-step" aria-current={i === index ? 'step' : undefined} data-done={complete(reviews[i])} onClick={() => setIndex(i)}>
          <span>{complete(reviews[i]) ? <Check size={12} /> : i + 1}</span>
          {item.timing}
        </button>
      </li>)}
    </ol>
    <div className="training-card">
      <div className="training-card-head"><span className="training-tag">{step.channel}</span><span className="training-count">Paso {index + 1} de {PRE_CALL_STEPS.length}</span></div>
      <h3>{step.timing}</h3>
      <p>{step.objective}</p>
      <div className="training-examples">
        <div className="training-example" data-tone="good"><span><Check size={13} />Ejemplo que funciona</span><p>{step.exampleGood}</p></div>
        <div className="training-example" data-tone="bad"><span><AlertTriangle size={13} />Ejemplo que falla</span><p>{step.exampleBad}</p></div>
      </div>
      <label htmlFor="precall-message">Tu mensaje para este momento
        <textarea id="precall-message" value={draft} onChange={event => edit(event.target.value)} rows={4} maxLength={1200} placeholder="Escríbelo como se lo mandarías de verdad, con su nombre y su cita…" />
      </label>
      <div className="training-actions">
        <button type="button" className="primary" onClick={check} disabled={!draft.trim()}><Check size={15} />Revisar mi mensaje</button>
        {index > 0 && <button type="button" onClick={() => setIndex(index - 1)}><ArrowLeft size={15} />Anterior</button>}
        {index < PRE_CALL_STEPS.length - 1 && <button type="button" onClick={() => setIndex(index + 1)}>Siguiente<ArrowRight size={15} /></button>}
      </div>
      {review && <Outcome review={review} title="Revisión por criterios" note="La revisión comprueba reglas sobre tu texto (momento, petición, tono, longitud y lo propio de este paso). No corrige el estilo ni sustituye a una persona." />}
    </div>
    <div className="training-rules">
      <h3><Target size={15} />Reglas de show-rate</h3>
      <ul>{SHOW_RATE_RULES.map(rule => <li key={rule}>{rule}</li>)}</ul>
    </div>
  </div>;
}

// ---- Módulo 2: venta lógica -------------------------------------------------

function Logica() {
  const [inputs, setInputs] = useState({ brecha: '', coste: '', meses: '' });
  const [review, setReview] = useState<ReturnType<typeof reviewLogica> | null>(null);
  const [close, setClose] = useState('');
  const [closeReview, setCloseReview] = useState<Review | null>(null);
  const all = Boolean(review && review.met === review.total);
  const field = (id: keyof typeof inputs, label: string, hint: string) => <label htmlFor={`logica-${id}`}>{label}
    <input id={`logica-${id}`} inputMode="decimal" value={inputs[id]} placeholder={hint} autoComplete="off" onChange={event => { setInputs(current => ({ ...current, [id]: event.target.value })); setReview(null); }} />
  </label>;

  return <div className="training-module">
    <div className="training-intro">
      <Calculator size={18} />
      <div><h2>Venta lógica</h2><p>El coste de seguir igual, con las cifras que ella te dio. Sin dramatismo: números suyos y una pregunta.</p></div>
    </div>
    <div className="training-figures">
      <div><span>Meta</span><b>{LOGICA.figures.meta.toLocaleString('es-ES')} €/mes</b></div>
      <div><span>Ingreso actual</span><b>{LOGICA.figures.ingresoActual.toLocaleString('es-ES')} €/mes</b></div>
      <div><span>Ahorro</span><b>{LOGICA.figures.ahorroMensual} €/mes</b></div>
      <div><span>Horizonte</span><b>{LOGICA.figures.horizonteAnos} años</b></div>
    </div>
    <p className="training-note">Cifras inventadas para el ejercicio. No son el caso de nadie real ni una promesa de ingresos.</p>
    <div className="training-card">
      <h3>Haz el cálculo</h3>
      <p>Escribe el resultado de cada cuenta. Acepta formato español: 3.200 o 3200.</p>
      <div className="training-grid-3">
        {field('brecha', 'Brecha mensual', 'Meta menos ingreso actual')}
        {field('coste', 'Coste de seguir igual cinco años', 'Brecha × 12 × 5')}
        {field('meses', 'Meses de ahorro para igualar un mes de brecha', 'Brecha ÷ ahorro')}
      </div>
      <div className="training-actions">
        <button type="button" className="primary" onClick={() => { const result = reviewLogica(inputs); setReview(result); void logActivity({ kind: 'training_review', ref: 'logica', detail: { met: result.met, total: result.total } }); }} disabled={!inputs.brecha.trim() && !inputs.coste.trim() && !inputs.meses.trim()}><Check size={15} />Comprobar el cálculo</button>
      </div>
      {review && <Outcome review={review} title="Cálculo" note="Si las tres cuentas están bien, ya tienes la frase. El resto es no estropearla hablando." />}
      {all && <div className="training-script">
        <span className="eyebrow">CÓMO SE DICE</span>
        <p>«{LOGICA.disyuntiva}»</p>
        <p className="training-emphasis">{LOGICA.silenceRule}</p>
        <p className="training-note">{LOGICA.task}</p>
      </div>}
    </div>
    <div className="training-card">
      <h3>Tu frase de cierre</h3>
      <p>Escribe cómo lo dirías tú, con la cifra y los dos caminos. Después se comprueba que no rellenas el silencio.</p>
      <label htmlFor="logica-close">Tu frase
        <textarea id="logica-close" value={close} onChange={event => { setClose(event.target.value); setCloseReview(null); }} rows={3} maxLength={600} placeholder="Con lo que me cuentas, tienes dos caminos…" />
      </label>
      <div className="training-actions">
        <button type="button" onClick={() => { const result = reviewCloseLine(close); setCloseReview(result); void logActivity({ kind: 'training_review', ref: 'logica', detail: { met: result.met, total: result.total } }); }} disabled={!close.trim()}><Check size={15} />Revisar mi frase</button>
      </div>
      {closeReview && <Outcome review={closeReview} title="Tu frase" note="El ejercicio no puede comprobar el silencio: eso lo decides tú en la llamada real. Aquí solo se revisa que no pidas aprobación al soltar el número." />}
    </div>
  </div>;
}

// ---- Módulo 3: anti-freezing ------------------------------------------------

function Freezing() {
  const [messages, setMessages] = useState<{ role: 'them' | 'you'; text: string }[]>([{ role: 'them', text: FREEZING.attacks[0] }]);
  const [draft, setDraft] = useState('');
  const [done, setDone] = useState(false);
  const [reactivation, setReactivation] = useState(false);
  const answers = useMemo(() => messages.filter(item => item.role === 'you').map(item => item.text), [messages]);
  const falls = freezingFalls(answers);
  const moral = moralFor(falls);
  const review = useMemo(() => reviewFreezing(answers), [answers]);

  function reset() {
    setMessages([{ role: 'them', text: FREEZING.attacks[0] }]);
    setDraft(''); setDone(false); setReactivation(false);
  }
  function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || done) return;
    const spoke = answers.length + 1;
    const next = [...messages, { role: 'you' as const, text }];
    if (spoke < FREEZING.attacks.length) next.push({ role: 'them', text: FREEZING.attacks[spoke] });
    setMessages(next); setDraft('');
    if (spoke >= FREEZING.attacks.length) { setDone(true); void logActivity({ kind: 'training_review', ref: 'freezing', detail: { met: FREEZING.attacks.length - freezingFalls([...answers, text]), total: FREEZING.attacks.length } }); }
    if (freezingFalls([...answers, text]) >= 2) setReactivation(true);
  }

  return <div className="training-module">
    <div className="training-intro">
      <ShieldAlert size={18} />
      <div><h2>Anti-freezing</h2><p>El personaje te ataca. No hay respuestas correctas: hay un protocolo para no encogerse.</p></div>
    </div>
    <div className="training-protocol">
      <h3>Protocolo</h3>
      <ol>{FREEZING.protocol.map((item, i) => <li key={item}><span>{i + 1}</span>{item}</li>)}</ol>
      <p className="training-note">{FREEZING.rule}</p>
    </div>
    <div className="training-moral" data-tone={moral.tone}>
      <Heart size={16} />
      <div><span>Moral estimada por tu texto</span><b>{moral.level}</b><p>{moral.detail}</p></div>
      <div className="training-moral-count"><b>{falls}</b><small>caídas</small></div>
    </div>
    <div className="training-chat">
      <div className="training-chat-body" aria-live="polite">
        {messages.map((item, i) => <div className="training-turn" data-mine={item.role === 'you'} key={`${i}-${item.role}`}>
          <div className="training-bubble"><p>{item.text}</p></div>
        </div>)}
      </div>
      {!done ? <form className="training-composer" onSubmit={send}>
        <label htmlFor="freezing-reply" className="sr-only">Tu respuesta al ataque</label>
        <textarea id="freezing-reply" value={draft} onChange={event => setDraft(event.target.value)} rows={2} maxLength={800} placeholder="Acepta, valida y vuelve a preguntar…" />
        <button className="primary" type="submit" disabled={!draft.trim()}>Responder</button>
      </form> : <div className="training-actions training-actions-inset">
        <button type="button" onClick={reset}><RotateCcw size={15} />Empezar de nuevo</button>
      </div>}
    </div>
    {reactivation && <div className="training-reactivation">
      <h3><Heart size={15} />Antes de seguir</h3>
      <ul>{FREEZING.reactivation.map(item => <li key={item}>{item}</li>)}</ul>
      <button type="button" className="text-button" onClick={() => setReactivation(false)}>He leído, continuar</button>
    </div>}
    {done && <div className="training-card">
      <Outcome review={review} title="Cómo has sostenido los cinco ataques" note="La moral y los criterios se estiman con marcas en tu texto (aceptar, validar, looping, «pero», defensa, calma y pregunta). No se analiza tu voz: eso exige una grabación y un consentimiento aparte." />
      {review.met === review.total && <p className="training-emphasis">Los cinco ataques se sostienen. Ahora repítelo con una persona que no te caiga bien.</p>}
    </div>}
  </div>;
}

// ---- Módulo 4: yellows ------------------------------------------------------

function Yellows() {
  const [leadId, setLeadId] = useState(YELLOW_LEADS[0].id);
  const lead = YELLOW_LEADS.find(item => item.id === leadId) ?? YELLOW_LEADS[0];
  const [messages, setMessages] = useState<{ role: 'them' | 'you'; text: string }[]>([{ role: 'them', text: lead.opening }]);
  const [draft, setDraft] = useState('');
  const [done, setDone] = useState(false);
  const answers = messages.filter(item => item.role === 'you').map(item => item.text);
  const mistakes = yellowMistakes(answers);
  const blocked = mistakes >= YELLOW_BLOCK;
  const review = reviewYellows(answers);

  function pick(id: string) {
    const next = YELLOW_LEADS.find(item => item.id === id) ?? YELLOW_LEADS[0];
    setLeadId(id);
    setMessages([{ role: 'them', text: next.opening }]);
    setDraft(''); setDone(false);
  }
  function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || done || blocked) return;
    const asked = answers.length;
    // Respuesta guionizada y por turnos, no aleatoria: el mismo ejercicio da lo mismo.
    const next = [...messages, { role: 'you' as const, text }, { role: 'them' as const, text: lead.replies[asked % lead.replies.length] }];
    setMessages(next); setDraft('');
  }

  return <div className="training-module">
    <div className="training-intro">
      <AlertTriangle size={18} />
      <div><h2>Yellows are golds</h2><p>Tres leads que no colaboran. La respuesta del personaje está guionizada: aquí entrenas tu pregunta, no adivinas.</p></div>
    </div>
    <div className="training-chips" role="group" aria-label="Tipo de lead">
      {YELLOW_LEADS.map(item => <button key={item.id} type="button" aria-pressed={item.id === leadId} onClick={() => pick(item.id)}>{item.name}</button>)}
    </div>
    <div className="training-card">
      <p><strong>Comportamiento:</strong> {lead.behavior}</p>
      <p><strong>Reto:</strong> {lead.challenge}</p>
      <p className="training-note">{YELLOW_RULE}</p>
    </div>
    <div className="training-moral" data-tone={blocked ? 'bajo' : mistakes ? 'medio' : 'alto'}>
      <TrendingUp size={16} />
      <div><span>Ritmo de aprendizaje</span><b>{mistakes} de {YELLOW_BLOCK} mensajes sin pregunta</b><p>A los tres mensajes seguidos sin pregunta, el ejercicio se detiene: se vuelve a empezar.</p></div>
    </div>
    <div className="training-chat">
      <div className="training-chat-body" aria-live="polite">
        {messages.map((item, i) => <div className="training-turn" data-mine={item.role === 'you'} key={`${i}-${item.role}`}>
          <div className="training-bubble"><p>{item.text}</p></div>
        </div>)}
      </div>
      {blocked ? <div className="training-actions training-actions-inset">
        <p className="training-emphasis">Bloqueado: tres mensajes sin pregunta. Un lead cerrado necesita preguntas concretas, no argumentos.</p>
        <button type="button" onClick={() => pick(leadId)}><RotateCcw size={15} />Reintentar desde cero</button>
      </div> : !done ? <form className="training-composer" onSubmit={send}>
        <label htmlFor="yellow-reply" className="sr-only">Tu mensaje al lead</label>
        <textarea id="yellow-reply" value={draft} onChange={event => setDraft(event.target.value)} rows={2} maxLength={800} placeholder="Pregunta por lo que no cuadra…" />
        <button className="primary" type="submit" disabled={!draft.trim()}>Enviar</button>
      </form> : null}
    </div>
    <div className="training-actions">
      {!done && !blocked && <button type="button" onClick={() => { setDone(true); void logActivity({ kind: 'training_review', ref: 'yellows', detail: { met: Math.max(0, answers.length - yellowMistakes(answers)), total: Math.max(1, answers.length) } }); }} disabled={answers.length < 2}><Flag size={15} />Terminar y revisar</button>}
      {done && <Outcome review={review} title="Qué ha pasado con este lead" note="Se cuentan preguntas, concreción y longitud. No se juzga si el lead era o no real: eso no se puede saber desde un guion." />}
    </div>
  </div>;
}

// ---- Módulo 5: STAR ---------------------------------------------------------

function Star() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [tried, setTried] = useState(false);
  const all = STAR_CRITERIA.every(item => checked[item.letter]);

  return <div className="training-module">
    <div className="training-intro">
      <Zap size={18} />
      <div><h2>Calificación STAR</h2><p>Marca lo que ya sabes de este lead. Si falta algo, no es una objeción: es una pregunta que no hiciste.</p></div>
    </div>
    <fieldset className="training-star">
      <legend className="sr-only">Criterios STAR del lead</legend>
      {STAR_CRITERIA.map(item => <label key={item.letter} className="training-star-item" data-checked={Boolean(checked[item.letter])}>
        <input type="checkbox" checked={Boolean(checked[item.letter])} onChange={event => { setChecked(current => ({ ...current, [item.letter]: event.target.checked })); setTried(false); }} />
        <span className="training-star-letter">{item.letter}</span>
        <span><strong>{item.name}</strong><em>{item.question}</em><small>{item.description}</small></span>
      </label>)}
    </fieldset>
    <div className="training-rules" data-tone="warning">
      <h3><AlertTriangle size={15} />Regla de oro</h3>
      <p>{STAR_RULE}</p>
    </div>
    <div className="training-actions">
      <button type="button" className={all ? 'primary' : ''} onClick={() => { setTried(true); void logActivity({ kind: 'training_review', ref: 'star', detail: { met: STAR_CRITERIA.filter(item => checked[item.letter]).length, total: STAR_CRITERIA.length } }); }}>{all ? <><CheckCircle2 size={15} />Lead calificado: puedes cerrar</> : <>Intentar cerrar con este lead</>}</button>
    </div>
    {tried && all && <p className="training-emphasis">Los cuatro criterios están verificados. Ahora el cierre es una decisión, no una sorpresa.</p>}
    {tried && !all && <div className="training-warning" role="status"><AlertTriangle size={16} /><div><strong>Intento de cierre sin calificar</strong><p>La objeción que recibas no será la real: será el síntoma de que preguntaste tarde. Vuelve a la conversación y verifica lo que falta.</p></div></div>}
  </div>;
}

// ---- Módulo 9: banco de preguntas de entrevista ------------------------------

function InterviewBank() {
  const [index, setIndex] = useState(0);
  // Las respuestas viven solo en esta visita: no se guardan ni se envían (pueden contar datos personales).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const question = INTERVIEW_QUESTIONS[index];
  const draft = drafts[question.id] ?? '';
  const review = reviews[question.id] ?? null;
  const done = INTERVIEW_QUESTIONS.filter(item => complete(reviews[item.id] ?? null)).length;

  function edit(value: string) {
    setDrafts(current => ({ ...current, [question.id]: value }));
    setReviews(current => { const next = { ...current }; delete next[question.id]; return next; });
  }
  function check() {
    const result = reviewInterviewAnswer(question.id, draft);
    setReviews(current => ({ ...current, [question.id]: result }));
    void logActivity({ kind: 'training_review', ref: 'entrevista', detail: { met: result.met, total: result.total } });
  }

  return <div className="training-module">
    <div className="training-intro">
      <MessageSquare size={18} />
      <div><h2>Banco de preguntas de entrevista</h2><p>Diez preguntas que casi siempre salen. Lee qué evalúa quien pregunta, escribe tu respuesta con tus propios datos y comprueba las banderas rojas.</p></div>
      <span className="training-count">{done} de {INTERVIEW_QUESTIONS.length} sin banderas</span>
    </div>
    <ol className="training-steps" aria-label="Preguntas de entrevista">
      {INTERVIEW_QUESTIONS.map((item, i) => <li key={item.id}>
        <button type="button" className="training-step" aria-current={i === index ? 'step' : undefined} data-done={complete(reviews[item.id] ?? null)} onClick={() => setIndex(i)}>
          <span>{complete(reviews[item.id] ?? null) ? <Check size={12} /> : i + 1}</span>
          Pregunta {i + 1}
        </button>
      </li>)}
    </ol>
    <div className="training-card">
      <div className="training-card-head"><span className="training-tag">Pregunta {index + 1} de {INTERVIEW_QUESTIONS.length}</span></div>
      <h3>{question.question}</h3>
      <p><strong>Qué evalúa:</strong> {question.intent}</p>
      <p><strong>Fórmula:</strong> {question.formula}</p>
      <details><summary>Ver un ejemplo con huecos</summary>
        <div className="training-example" data-tone="good"><span><Check size={13} />Ejemplo ilustrativo</span><p>{question.example}</p></div>
        <p className="training-note">Los huecos [así] son para tus datos reales: no copies cifras ni resultados que no sean tuyos.</p>
      </details>
      <label htmlFor="interview-answer">Tu respuesta
        <textarea id="interview-answer" value={draft} onChange={event => edit(event.target.value)} rows={6} maxLength={1500} placeholder="Escríbela como la dirías en voz alta, con un caso real tuyo…" />
      </label>
      <div className="training-actions">
        <button type="button" className="primary" onClick={check} disabled={!draft.trim()}><Check size={15} />Comprobar banderas rojas</button>
        {index > 0 && <button type="button" onClick={() => setIndex(index - 1)}><ArrowLeft size={15} />Anterior</button>}
        {index < INTERVIEW_QUESTIONS.length - 1 && <button type="button" onClick={() => setIndex(index + 1)}>Siguiente<ArrowRight size={15} /></button>}
      </div>
      {review && <Outcome review={review} title="Banderas rojas de esta respuesta" note="Reglas sobre tu texto (ejemplo concreto, cifras, tono, longitud, preguntas). No puntúan tu candidatura ni sustituyen a una persona; tu respuesta no se guarda ni se envía." />}
    </div>
  </div>;
}

// ---- Módulo 6: certificación y examen --------------------------------------

function Certification() {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ReturnType<typeof gradeExam> | null>(null);
  const [stored, setStored] = useState<ExamStored | null>(null);
  const [checkedOpen, setCheckedOpen] = useState(false);

  useEffect(() => { setStored(readExam()); }, []);

  function submit() {
    const graded = gradeExam(answers);
    setResult(graded);
    void logActivity({ kind: 'training_exam', ref: 'final', detail: { correct: graded.correct, total: graded.total } });
    const saved: ExamStored = { score: graded.score, total: graded.total, passed: graded.passed, at: Date.now() };
    setStored(saved);
    try { window.localStorage.setItem(EXAM_KEY, JSON.stringify(saved)); } catch { /* sin almacenamiento */ }
  }
  function retry() { setAnswers({}); setResult(null); setCheckedOpen(false); }
  const openQuestions = FINAL_EXAM.filter(question => question.type === 'open');

  return <div className="training-module">
    <div className="training-intro">
      <Award size={18} />
      <div><h2>Ruta de cuatro semanas</h2><p>Qué se practica cada semana y qué hay que entregar. El examen de egreso cierra la ruta.</p></div>
      {stored && <span className="training-count" data-ok={stored.passed}>{stored.passed ? `Examen superado · ${stored.score}/100` : `Último intento · ${stored.score}/100`}</span>}
    </div>
    <ol className="training-weeks">{CERTIFICATION_WEEKS.map(week => <li key={week.week} className="training-week">
      <div className="training-week-head"><span>{week.week}</span><div><h3>{week.title}</h3><p>{week.focus}</p></div><b>Mín. {week.minScore}%</b></div>
      <ul>{week.deliverables.map(item => <li key={item}><Target size={13} />{item}</li>)}</ul>
    </li>)}</ol>
    <div className="training-card">
      <h3><Brain size={16} />Escalera de creencias</h3>
      <p>Dónde se rompe la venta y qué se dice en cada escalón.</p>
      <ol className="training-ladder">{BELIEF_LADDER.map(item => <li key={item.id}>
        <strong>{item.level}</strong>
        <em>{item.belief}</em>
        <blockquote>«{item.symptom}»</blockquote>
        <p>{item.script}</p>
        <p className="training-emphasis">{item.close}</p>
      </li>)}</ol>
    </div>
    <div className="training-rules">
      <h3><MessageSquare size={15} />Marcos de identidad</h3>
      <p>{IDENTITY_FRAMES.disarming}</p>
      <p className="training-note">{IDENTITY_FRAMES.rule}</p>
    </div>
    <div className="training-card">
      <div className="training-card-head"><h3>Examen de egreso</h3><span className="training-count">{EXAM_PASS}% para superarlo</span></div>
      <p>Seis preguntas de respuesta única y dos de desarrollo. Las de desarrollo no suman nota: las revisas tú con la rúbrica.</p>
      {!result ? <>
        <ol className="training-exam">{FINAL_EXAM.map((question, i) => <li key={question.id} className="training-question">
          <p><span>{i + 1}</span>{question.question}</p>
          {question.type === 'multiple' && <fieldset className="training-options"><legend className="sr-only">{question.question}</legend>
            {question.options?.map(option => <label key={option} data-selected={answers[question.id] === option}>
              <input type="radio" name={question.id} value={option} checked={answers[question.id] === option} onChange={() => setAnswers(current => ({ ...current, [question.id]: option }))} />
              {option}
            </label>)}
          </fieldset>}
          {question.type === 'open' && <label className="training-open">Tu respuesta
            <textarea value={answers[question.id] ?? ''} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} rows={4} maxLength={1500} placeholder="Escribe tu respuesta…" />
          </label>}
        </li>)}</ol>
        <div className="training-actions">
          <button type="button" className="primary" onClick={submit} disabled={FINAL_EXAM.filter(q => q.type === 'multiple').some(q => !answers[q.id])}><Flag size={15} />Corregir el examen</button>
        </div>
        <p className="training-note">Para corregir hacen falta las seis respuestas únicas. Las dos de desarrollo se pueden dejar en blanco.</p>
      </> : <div className="training-result">
        <div className="training-result-score" data-band={result.passed ? 'alto' : 'bajo'}><b>{result.score}</b><span>/100</span><small>{result.correct} de {result.total} correctas</small></div>
        <div>
          <h3>{result.passed ? 'Examen superado' : 'Todavía no'}</h3>
          <p>{result.passed ? 'Has completado la ruta formativa. Esto acredita tu práctica en esta app; no es una certificación oficial ni un título emitido por WDC.' : `Necesitas ${EXAM_PASS}% (las ${result.total} respuestas únicas correctas). Revisa las que fallan y vuelve a intentarlo.`}</p>
        </div>
        <ul className="training-criteria">{FINAL_EXAM.filter(q => q.type === 'multiple').map(question => {
          const ok = answers[question.id] === question.correctAnswer;
          return <li key={question.id} data-ok={ok}>{ok ? <Check size={14} /> : <X size={14} />}<span>{question.question} <strong>{ok ? 'Correcta.' : `Correcta: ${question.correctAnswer}.`}</strong></span></li>;
        })}</ul>
        <div className="training-open-check">
          <h3>Las dos de desarrollo</h3>
          <p>Compáralas con la rúbrica. No se puntúan porque una revisión automática de texto libre no puede distinguir una respuesta buena de una que suena bien.</p>
          <ul>{openQuestions.map(question => <li key={question.id}>
            <strong>{question.question}</strong>
            <p className="training-answer">{answers[question.id]?.trim() || 'Sin respuesta.'}</p>
            <p className="training-note">Rúbrica: {question.rubric}</p>
          </li>)}</ul>
          <label className="check-label"><input type="checkbox" checked={checkedOpen} onChange={event => setCheckedOpen(event.target.checked)} />He revisado mis respuestas con la rúbrica</label>
        </div>
        <div className="training-actions"><button type="button" onClick={retry}><RotateCcw size={15} />Repetir el examen</button></div>
      </div>}
    </div>
  </div>;
}

// ---- Módulos 6 y 7: biblioteca de cierres y pasos de descubrimiento ----------

// Banco de situaciones corregido por clave: sin IA ni texto libre. Solo se guarda el número de aciertos.
function Bank({ bank, refId, legend, verb }: { bank: BankQuestion[]; refId: 'cierres' | 'descubrimiento'; legend: string; verb: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ReturnType<typeof gradeBank> | null>(null);
  function submit() {
    const graded = gradeBank(bank, answers);
    setResult(graded);
    void logActivity({ kind: 'training_review', ref: refId, detail: { met: graded.correct, total: graded.total } });
  }
  return <div className="training-card" data-testid={`bank-${refId}`}>
    <div className="training-card-head"><h3>{legend}</h3><span className="training-count">{bank.length} situaciones</span></div>
    <ol className="training-exam">{bank.map((question, i) => <li key={question.id} className="training-question">
      <p><span>{i + 1}</span>{question.prompt}</p>
      <fieldset className="training-options" disabled={Boolean(result)}><legend className="sr-only">{question.prompt}</legend>
        {question.options.map(option => <label key={option} data-selected={answers[question.id] === option}>
          <input type="radio" name={question.id} value={option} checked={answers[question.id] === option} onChange={() => setAnswers(current => ({ ...current, [question.id]: option }))} />
          {option}
        </label>)}
      </fieldset>
      {result && <p className="training-note" data-ok={!result.wrong.includes(question.id)}>{result.wrong.includes(question.id) ? `Era: ${question.answer}.` : 'Correcta.'}</p>}
    </li>)}</ol>
    {!result ? <div className="training-actions"><button type="button" className="primary" onClick={submit} disabled={bank.some(question => !answers[question.id])}><Flag size={15} />{verb}</button></div>
      : <div className="training-result"><div className="training-result-score" data-band={result.correct === result.total ? 'alto' : 'bajo'}><b>{result.correct}</b><span>/{result.total}</span><small>aciertos</small></div>
        <div className="training-actions"><button type="button" onClick={() => { setAnswers({}); setResult(null); }}><RotateCcw size={15} />Repetir</button></div></div>}
    <p className="training-note">Se corrige por clave, no evalúa cómo suena en una llamada real. Solo se guarda cuántas aciertas.</p>
  </div>;
}

function Closes() {
  return <div className="training-module">
    <div className="training-intro">
      <Target size={18} />
      <div><h2>Los diez cierres</h2><p>Cada cierre sirve para un momento concreto. Los ejemplos llevan [importe] y [plazo] donde el método original traía cifras: pon las de tu oferta real, no las de otra.</p></div>
    </div>
    <ol className="training-ladder">{EXACT_CLOSES.map(item => <li key={item.id}>
      <strong>{item.name}</strong>
      <em>Cuándo: {item.when}</em>
      <p>{item.formula}</p>
      <blockquote>{item.example}</blockquote>
      <p className="training-note">{item.concept}</p>
    </li>)}</ol>
    <Bank bank={CLOSE_BANK} refId="cierres" legend="¿Qué cierre pide cada llamada?" verb="Corregir mis respuestas" />
  </div>;
}

function Discovery() {
  return <div className="training-module">
    <div className="training-intro">
      <Brain size={18} />
      <div><h2>Los nueve pasos de descubrimiento</h2><p>Se recorren en orden: entender dónde está, qué quiere, qué se lo impide y por qué le importa, antes de resumir y confirmar. Si aparece más dolor, se vuelve al principio.</p></div>
    </div>
    <ol className="training-ladder">{DISCOVERY_STEPS.map(item => <li key={item.step}>
      <strong>{item.step}. {item.name}</strong>
      <p>{item.description}</p>
      <em>{item.technique}</em>
      <blockquote>{item.example}</blockquote>
    </li>)}</ol>
    <Bank bank={DISCOVERY_BANK} refId="descubrimiento" legend="¿A qué paso pertenece cada frase?" verb="Corregir mis respuestas" />
  </div>;
}

const BODIES: Record<TrainingId, ComponentType> = {
  precall: PreCall,
  logica: Logica,
  freezing: Freezing,
  yellows: Yellows,
  star: Star,
  cierres: Closes,
  descubrimiento: Discovery,
  entrevista: InterviewBank,
  certificacion: Certification,
};

// Formación comercial: nueve módulos de método y un examen. Todo se corrige en el
// navegador con reglas; nada se envía a un proveedor ni evalúa a la alumna.
export default function StudentTraining() {
  const [open, setOpen] = useState<TrainingId | null>(null);
  const [stored, setStored] = useState<ExamStored | null>(null);
  useEffect(() => { setStored(readExam()); }, []);

  if (open) {
    const Body = BODIES[open];
    return <section className="training">
      <button type="button" className="training-back" onClick={() => { setOpen(null); setStored(readExam()); }}><ArrowLeft size={16} />Todos los módulos</button>
      <Body />
      <p className="training-note">Formación de método. Los ejercicios se corrigen con reglas sobre tu texto, sin IA, y no evalúan tu candidatura ni emiten títulos.</p>
    </section>;
  }

  return <section className="training">
    <div className="training-head">
      <div>
        <span className="eyebrow">FORMACIÓN COMERCIAL</span>
        <h1>Aprende el método antes de improvisar.</h1>
        <p>Nueve módulos para practicar las partes de la conversación que se pueden entrenar: antes de la llamada, la brecha, la presión, los leads difíciles, la calificación, los diez cierres, el descubrimiento, las preguntas de entrevista y el examen final.</p>
      </div>
      <span className="training-icon"><GraduationCap size={28} strokeWidth={1.4} /></span>
    </div>
    <div className="training-grid">
      {TRAINING_MODULES.map(item => <article className="training-card" key={item.id}>
        <div className="training-card-head"><span className="training-tag">{item.tag}</span><span className="training-count"><Clock3 size={13} />{item.minutes} min</span></div>
        <h2>{item.title}</h2>
        <p>{item.summary}</p>
        <div className="training-card-foot">
          <span>{item.id === 'certificacion' && stored ? (stored.passed ? `Examen superado · ${stored.score}/100` : `Último intento · ${stored.score}/100`) : 'Ejercicio sin nota'}</span>
          <button type="button" className="primary" onClick={() => setOpen(item.id)}>Abrir módulo<ArrowRight size={15} /></button>
        </div>
      </article>)}
    </div>
    <div className="training-rules">
      <h3><Sparkles size={15} />Cómo se corrige</h3>
      <p>Los ejercicios comprueban criterios del método sobre lo que escribes: si mencionas el momento, si pides una confirmación, si usas «pero» al validar, si haces la cuenta bien. No hay modelo de lenguaje, no se envía tu texto a ningún sitio y no se guarda en el servidor.</p>
      <p className="training-note">El progreso del examen se guarda en este navegador. Borrar los datos del sitio lo borra también.</p>
    </div>
  </section>;
}
