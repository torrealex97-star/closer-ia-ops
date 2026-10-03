'use client';
import { useEffect, useState } from 'react';
import { BrainCircuit, KeyRound, Search, Sparkles } from 'lucide-react';
import { request } from './client';

import type { components } from '../../../packages/contracts/api';
type AIConfig = components['schemas']['AIConfig'];
type ClassificationConfig = components['schemas']['ClassificationStatus'];
// Operator intent: connect once, see connection status and daily limits without API jargon.
// Reuses the workspace's cream inset controls, 4px spacing and terracotta action color.
export default function IntegrationSettings({ onChanged }: { onChanged: () => Promise<void> }) {
  const [apify, setApify] = useState(false);
  const [serpapi, setSerpapi] = useState(false);
  const [serpapiKey, setSerpapiKey] = useState('');
  const [ai, setAI] = useState<AIConfig>({ provider: 'groq', enabled: false, has_token: false, model: 'openai/gpt-oss-20b', daily_limit: 20, used_today: 0, max_input_characters: 6000, max_output_tokens: 900 });
  const [classification, setClassification] = useState<ClassificationConfig | null>(null);
  const [apifyKey, setApifyKey] = useState('');
  const [aiKey, setAIKey] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { Promise.all([request<{ has_token: boolean }>('integrations/apify'), request<{ has_token: boolean }>('integrations/serpapi'), request<AIConfig>('integrations/ai'), request<ClassificationConfig>('ai/classification')]).then(([a, s, b, c]) => { setApify(a.has_token); setSerpapi(s.has_token); setAI(b); setClassification(c); }).catch(e => setError(e.message)); }, []);
  async function chooseProvider(provider: AIConfig['provider']) {
    setBusy(true); setAIKey(''); setError(''); setMessage('');
    try { setAI(await request<AIConfig>(`integrations/ai?provider=${provider}`)); setDirty(true); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const providerName = ai.provider === 'groq' ? 'Groq' : 'OpenAI';
  async function action(provider: 'apify' | 'serpapi' | 'ai', mode: 'save' | 'check' | 'remove') {
    setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'check') {
        const result = await request<{ message: string }>(`integrations/${provider}/check`, {}); setMessage(result.message);
      } else {
        const body = provider === 'apify' ? { token: apifyKey, clear_token: mode === 'remove' } : provider === 'serpapi' ? { token: serpapiKey, clear_token: mode === 'remove' } : { provider: ai.provider, token: aiKey, clear_token: mode === 'remove', enabled: mode !== 'remove' && ai.enabled, model: ai.model, daily_limit: ai.daily_limit };
        if (mode === 'remove') body.token = '';
        const result = await request<AIConfig>(`integrations/${provider}`, body);
        if (provider === 'apify') { setApify(result.has_token); setApifyKey(''); } else if (provider === 'serpapi') { setSerpapi((result as { has_token: boolean }).has_token); setSerpapiKey(''); } else { setAI(result); setAIKey(''); setDirty(false); }
        request<ClassificationConfig>('ai/classification').then(setClassification).catch(() => {});
        await onChanged();
        setMessage(mode === 'remove' ? 'Clave eliminada.' : 'Conexión guardada. Puedes comprobarla sin lanzar una extracción ni generar texto.');
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function toggleMassive(enabled: boolean) {
    setBusy(true); setError('');
    try {
      const c = await request<ClassificationConfig>('ai/classification', { enabled: true, massive_after_collection: enabled, daily_limit: classification?.daily_limit ?? 25 }, 'PUT');
      setClassification(c);
      setMessage(enabled ? 'Clasificación automática activada: se encolará al terminar cada recogida.' : 'Clasificación automática desactivada.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="integration-settings" aria-label="Conexiones de la aplicación">
    <div className="results-heading"><h2>Conecta una vez. Úsalo en toda la app.</h2></div>
    {error && <p className="alert error" role="alert">{error}</p>}{message && <p className="alert" role="status">{message}</p>}
    <div className="connection-grid">
      <details className="source-card"><summary><KeyRound size={18} /> Cuenta de Apify <span className={apify ? 'available' : 'pending'}>{apify ? 'Clave guardada' : 'Sin conectar'}</span></summary><p>Una única clave para todas tus fuentes. El asistente busca el scraper y prepara sus instrucciones.</p><label>Clave de Apify<input type="password" autoComplete="new-password" value={apifyKey} placeholder={apify ? 'Vacío conserva la clave' : 'Pega aquí tu API token'} onChange={e => setApifyKey(e.target.value)} /></label><a href="https://console.apify.com/settings/integrations" target="_blank" rel="noopener noreferrer">Obtener mi clave de Apify ↗</a><div className="source-actions"><button disabled={busy || (!apifyKey && !apify)} onClick={() => action('apify', 'save')}>Guardar Apify</button><button disabled={busy || !apify} onClick={() => action('apify', 'check')}>Comprobar Apify</button>{apify && <button disabled={busy} onClick={() => action('apify', 'remove')}>Eliminar clave Apify</button>}</div></details>
      <details className="source-card"><summary><Search size={18} /> SerpApi · Google Jobs <span className={serpapi ? 'available' : 'pending'}>{serpapi ? 'Clave guardada' : 'Sin conectar'}</span></summary><p>Convierte los dorks del vocabulario WDC en búsquedas automáticas de ofertas ya indexadas en Google (LinkedIn, portales). Paga por búsqueda (~0,025 USD); las cacheadas son gratis.</p><label>Clave de SerpApi<input type="password" autoComplete="new-password" value={serpapiKey} placeholder={serpapi ? 'Vacío conserva la clave' : 'Pega aquí tu API key'} onChange={e => setSerpapiKey(e.target.value)} /></label><a href="https://serpapi.com/manage-api-key" target="_blank" rel="noopener noreferrer">Obtener mi clave de SerpApi ↗</a><div className="source-actions"><button disabled={busy || (!serpapiKey && !serpapi)} onClick={() => action('serpapi', 'save')}>Guardar SerpApi</button><button disabled={busy || !serpapi} onClick={() => action('serpapi', 'check')}>Comprobar SerpApi</button>{serpapi && <button disabled={busy} onClick={() => action('serpapi', 'remove')}>Eliminar clave SerpApi</button>}</div></details>
      <details className="source-card"><summary><Sparkles size={18} /> Motor de IA · {providerName} <span className={ai.has_token && ai.enabled ? 'available' : 'pending'}>{ai.has_token && ai.enabled ? 'Activado' : 'Desactivado'}</span></summary><p>{providerName} analiza las ofertas que tú elijas. Cada resultado se guarda y se reutiliza. No consume tokens durante la búsqueda.</p><label>Proveedor de IA<select disabled={busy} value={ai.provider} onChange={e => chooseProvider(e.target.value as AIConfig['provider'])}><option value="groq">Groq · principal</option><option value="openai">OpenAI · opcional</option></select></label><label>Clave de {providerName}<input type="password" autoComplete="new-password" value={aiKey} onChange={e => { setAIKey(e.target.value); setDirty(true); }} placeholder={ai.has_token ? 'Vacío conserva la clave' : 'Pega aquí tu clave API'} /></label><a href={ai.provider === 'groq' ? 'https://console.groq.com/keys' : 'https://platform.openai.com/api-keys'} target="_blank" rel="noopener noreferrer">Obtener mi clave de {providerName} ↗</a><label>Modelo<select value={ai.model} onChange={e => { setAI(old => ({ ...old, model: e.target.value })); setDirty(true); }}>{ai.provider === 'groq' ? <><option value="openai/gpt-oss-20b">GPT-OSS 20B · rápido</option><option value="openai/gpt-oss-120b">GPT-OSS 120B · revisión compleja</option></> : <><option value="gpt-4.1-mini">GPT-4.1 mini · equilibrado</option><option value="gpt-4.1-nano">GPT-4.1 nano · compacto</option><option value="gpt-4o-mini">GPT-4o mini</option></>}</select></label><label>Análisis nuevos por día (UTC)<input type="number" min={1} max={100} value={ai.daily_limit} onChange={e => { setAI(old => ({ ...old, daily_limit: Number(e.target.value) })); setDirty(true); }} /></label><label className="check-label"><input type="checkbox" checked={ai.enabled} onChange={e => { setAI(old => ({ ...old, enabled: e.target.checked })); setDirty(true); }} /> Habilitar análisis con IA</label><small>{ai.used_today} solicitudes hoy · máximo 6.000 caracteres de oferta y {ai.max_output_tokens} tokens de salida por análisis. El precio depende del modelo y de tu cuenta.</small><p className="muted">{dirty ? 'Guarda los cambios antes de comprobar la conexión.' : 'Cada proveedor conserva su propia clave. No hay cambios automáticos de proveedor.'}</p><div className="source-actions"><button disabled={busy} onClick={() => action('ai', 'save')}>Guardar motor de IA</button><button disabled={busy || !ai.has_token || dirty} onClick={() => action('ai', 'check')}>Comprobar IA</button>{ai.has_token && <button disabled={busy} onClick={() => action('ai', 'remove')}>Eliminar clave IA</button>}</div></details>
      <details className="source-card"><summary><BrainCircuit size={18} /> Clasificación automática tras la recogida <span className={classification?.massive_after_collection ? 'available' : 'pending'}>{classification?.massive_after_collection ? 'Activada' : 'Manual'}</span></summary><p>Cuando la recogida de las 08:00 termina, las ofertas cuyo título no está en el vocabulario se encolan para que la IA proponga su familia con evidencia literal. Respeta el límite diario de abajo, solo se ejecuta con motor activado y clave guardada, y los resultados se revisan en Clasificaciones IA.</p><label className="check-label"><input type="checkbox" checked={!!classification?.massive_after_collection} disabled={busy} onChange={e => void toggleMassive(e.target.checked)} /> Clasificar automáticamente las ofertas nuevas ambiguas</label><small>{classification ? `${classification.used_today}/${classification.daily_limit} clasificaciones hoy · motor ${classification.enabled ? 'activado' : 'desactivado'} · ${classification.has_token ? 'clave guardada' : 'sin clave'}` : 'Cargando estado…'}</small><p className="muted">Sin clave o con el motor apagado, la cola queda congelada y no se gasta nada. Cada oferta es una petición; revisa la evidencia antes de dar por buena una familia.</p></details>
    </div><small className="muted">Las claves se guardan en este ordenador y no se muestran al volver a abrir la configuración.</small>
  </section>;
}
