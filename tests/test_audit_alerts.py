"""Alertas del auditor de slugs JobToday: detección renamed/gone, persistencia
en .local/ y notificación macOS. El audit informa; nunca reescribe slugs."""
import json

from scripts.audit_sources import log_alert, slug_alerts, write_launchd_alert


def report(*statuses):
    """Estructura equivalente a la sección jobtoday_slugs de source_audit.json."""
    slugs = {}
    for i, status in enumerate(statuses):
        slugs[f'slug-{i}'] = {'code': f'slug-{i}', 'status': status, 'url': f'https://x/{i}',
                              'canonical_url': f'https://x/{i}', 'http_status': 200 if status == 'ok' else 308,
                              'checked_at': '2026-10-10T00:00:00+00:00'}
    return {'jobtoday_slugs': {'checked_at': '2026-10-10T00:00:00+00:00', 'slugs': slugs}}


def test_no_alert_when_all_ok(monkeypatch, tmp_path):
    monkeypatch.setattr('scripts.audit_sources.log_alert', lambda payload: None)
    payload = write_launchd_alert(report('ok', 'ok'), alert_dir=tmp_path)
    assert payload['has_alerts'] is False
    assert payload['alerts'] == []
    persisted = json.loads((tmp_path / 'source_audit_alert.json').read_text())
    assert persisted == payload


def test_renamed_and_gone_alerted(monkeypatch, tmp_path):
    seen = {}
    monkeypatch.setattr('scripts.audit_sources.log_alert', lambda payload: seen.update(payload=payload))
    payload = write_launchd_alert(report('ok', 'renamed', 'gone', 'unavailable', 'unreachable'), alert_dir=tmp_path)
    assert [a['status'] for a in payload['alerts']] == ['renamed', 'gone']
    # unavailable/unreachable son transitorios: no despiertan al operador.
    assert all(a['code'] not in ('slug-3', 'slug-4') for a in payload['alerts'])
    alert = payload['alerts'][0]
    assert alert['canonical_url'] and alert['checked_at'] and alert['http_status'] == 308
    assert seen['payload']['has_alerts'] is True


def test_write_launchd_alert_solo_lee(tmp_path):
    # La persistencia no reescribe source_audit.json (la evidencia del audit es inmuable).
    audit_file = tmp_path / 'audit.json'
    audit_file.write_text('{}')
    payload = write_launchd_alert(report('renamed'), alert_dir=tmp_path)
    assert audit_file.read_text() == '{}'
    assert payload['has_alerts']


def test_log_alert_notifica_solo_si_hay_alertas(monkeypatch):
    calls = []
    import subprocess
    monkeypatch.setattr(subprocess, 'run', lambda cmd, **kw: calls.append(cmd))
    log_alert({'has_alerts': False, 'alerts': []})
    assert calls == []
    log_alert({'has_alerts': True, 'alerts': [{'code': 'jobtoday', 'status': 'renamed',
                                              'canonical_url': 'https://nueva', 'renamed_from': 'https://vieja',
                                              'url': 'https://vieja', 'http_status': 308}]})
    assert len(calls) == 1 and 'osascript' in calls[0][0]


def test_alerta_menciona_codigo_y_destino():
    alerts = slug_alerts(report('renamed'))
    assert alerts[0]['status'] == 'renamed' and alerts[0]['canonical_url'] == 'https://x/0'
