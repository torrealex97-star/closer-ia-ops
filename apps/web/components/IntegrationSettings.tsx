'use client';
import { useEffect, useState } from 'react';
import { KeyRound, Sparkles } from 'lucide-react';
import { request } from './client';

type AIConfig = { enabled: boolean; has_token: boolean; model: string; daily_limit: number; used_today: number };
// Operator intent: connect once, see connection status and daily limits without API jargon.
// Reuses the workspace's cream inset controls, 4px spacing and terracotta action color.
export default function IntegrationSettings({ onChanged }: { onChanged: () => Promise<void> }) {
  const [apify, setApify] = useState(false);
  const [ai, setAI] = useState<AIConfig>({ enabled: false, has_token: false, model: 'gpt-4.1-mini', daily_limit: 20, used_today: 0 });
  const [apifyKey, setApifyKey] = useState('');
  const [aiKey, setAIKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { Promise.all([request<{ has_token: boolean }>('integrations/apify'), request<AIConfig>('integrations/ai')]).then(([a, b]) => { setApify(a.has_token); setAI(b); }).catch(e => setError(e.message)); }, []);
  async function action(provider: 'apify' | 'ai', mode: 'save' | 'check' | 'remove') {
    setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'check') {
        const result = await request<{ message: string }>(`integrations/${provider}/check`, {}); setMessage(result.message);
      } else {
        const body = provider === 'apify' ? { token: apifyKey, clear_token: mode === 'remove' } : { token: aiKey, clear_token: mode === 'remove', enabled: mode !== 'remove' && ai.enabled, model: ai.model, daily_limit: ai.daily_limit };
        if (mode === 'remove') body.token = '';
        const result = await request<AIConfig>(`integrations/${provider}`, body);
        if (provider === 'apify') { setApify(result.has_token); setApifyKey(''); } else { setAI(result); setAIKey(''); }
        await onChanged();
        setMessage(mode === 'remove' ? 'Clave eliminada.' : 'Conexión guardada. Puedes comprobarla sin lanzar una extracción ni generar texto.');
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="integration-settings" aria-label="Conexiones de la aplicación">
    <div className="results-heading"><h2>Conecta una vez. Úsalo en toda la app.</h2></div>
    {error && <p className="alert error" role="alert">{error}</p>}{message && <p className="alert" role="status">{message}</p>}
    <div className="connection-grid">
      <details className="source-card"><summary><KeyRound size={18} /> Cuenta de Apify <span className={apify ? 'available' : 'pending'}>{apify ? 'Clave guardada' : 'Sin conectar'}</span></summary><p>Una única clave para todas tus fuentes. El asistente busca el scraper y prepara sus instrucciones.</p><label>Clave de Apify<input type="password" autoComplete="new-password" value={apifyKey} placeholder={apify ? 'Vacío conserva la clave' : 'Pega aquí tu API token'} onChange={e => setApifyKey(e.target.value)} /></label><a href="https://console.apify.com/settings/integrations" target="_blank" rel="noopener noreferrer">Obtener mi clave de Apify ↗</a><div className="source-actions"><button disabled={busy || (!apifyKey && !apify)} onClick={() => action('apify', 'save')}>Guardar Apify</button><button disabled={busy || !apify} onClick={() => action('apify', 'check')}>Comprobar Apify</button>{apify && <button disabled={busy} onClick={() => action('apify', 'remove')}>Eliminar clave Apify</button>}</div></details>
      <details className="source-card"><summary><Sparkles size={18} /> Motor de IA <span className={ai.has_token && ai.enabled ? 'available' : 'pending'}>{ai.has_token && ai.enabled ? 'Activado' : 'Desactivado'}</span></summary><p>OpenAI analiza las ofertas que tú elijas. Cada resultado se guarda y se reutiliza. No consume tokens durante la búsqueda.</p><label>Clave de OpenAI<input type="password" autoComplete="new-password" value={aiKey} onChange={e => setAIKey(e.target.value)} placeholder={ai.has_token ? 'Vacío conserva la clave' : 'Pega aquí tu clave API'} /></label><a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">Obtener mi clave de OpenAI ↗</a><label>Modelo<select value={ai.model} onChange={e => setAI(old => ({ ...old, model: e.target.value }))}><option value="gpt-4.1-mini">GPT-4.1 mini · equilibrado</option><option value="gpt-4.1-nano">GPT-4.1 nano · compacto</option><option value="gpt-4o-mini">GPT-4o mini</option></select></label><label>Análisis nuevos por día (UTC)<input type="number" min={1} max={100} value={ai.daily_limit} onChange={e => setAI(old => ({ ...old, daily_limit: Number(e.target.value) }))} /></label><label className="check-label"><input type="checkbox" checked={ai.enabled} onChange={e => setAI(old => ({ ...old, enabled: e.target.checked }))} /> Habilitar análisis con IA</label><small>{ai.used_today} solicitudes hoy · máximo 6.000 caracteres de oferta y 600 tokens de salida por análisis. El precio depende del modelo y de tu cuenta.</small><div className="source-actions"><button disabled={busy} onClick={() => action('ai', 'save')}>Guardar motor de IA</button><button disabled={busy || !ai.has_token} onClick={() => action('ai', 'check')}>Comprobar IA</button>{ai.has_token && <button disabled={busy} onClick={() => action('ai', 'remove')}>Eliminar clave IA</button>}</div></details>
    </div><small className="muted">Las claves se guardan en este ordenador y no se muestran al volver a abrir la configuración.</small>
  </section>;
}
