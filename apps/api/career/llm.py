"""Replaceable, bounded provider transport. No hidden retries or fallback."""
import json
from dataclasses import dataclass
from typing import Protocol

import httpx

OPENAI_BASE = "https://api.openai.com/v1/"
GROQ_BASE = "https://api.groq.com/openai/v1/"
MODELS = {
    "groq": ("openai/gpt-oss-20b", "openai/gpt-oss-120b"),
    "openai": ("gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o-mini"),
}


class LLMError(ValueError):
    def __init__(self, message, code="provider_error"):
        super().__init__(message)
        self.code = code


@dataclass
class LLMResult:
    output: str
    usage: dict | None
    response_id: str | None
    completed: bool


class LLMProvider(Protocol):
    async def healthcheck(self, model: str, token: str) -> None: ...
    async def generate_structured(self, model: str, token: str, instructions: str, content: str, schema: dict) -> LLMResult: ...


async def request(provider, method, path, token, payload=None):
    if not token:
        raise LLMError(f"Conecta una clave de {provider.title()} en Fuentes → Motor de IA", "auth")
    base = GROQ_BASE if provider == "groq" else OPENAI_BASE
    try:
        async with httpx.AsyncClient(timeout=40, follow_redirects=False) as client:
            async with client.stream(method, base + path, headers={"Authorization": "Bearer " + token}, json=payload) as response:
                if response.status_code >= 300:
                    code = "rate_limited" if response.status_code == 429 else "auth" if response.status_code in (401, 403) else "uncertain" if response.status_code >= 500 else "provider_error"
                    raise LLMError(f"{provider.title()} respondió {response.status_code}. Revisa clave, cuota y acceso al modelo. No se ha reintentado automáticamente.", code)
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > 1_000_000:
                        raise LLMError("La respuesta de IA excede el tamaño permitido", "invalid_output")
                value = json.loads(data)
                if not isinstance(value, dict):
                    raise LLMError("Respuesta de IA no válida", "invalid_output")
                return value
    except (httpx.HTTPError, json.JSONDecodeError) as exc:
        raise LLMError("No se ha confirmado la respuesta de IA. No se reintentará automáticamente para evitar duplicar consumo.", "uncertain") from exc


class BaseProvider:
    code: str

    async def healthcheck(self, model, token):
        data = await request(self.code, "GET", "models/" + model, token)
        if data.get("id") != model:
            raise LLMError("El proveedor no ha confirmado el modelo seleccionado", "model_unavailable")


class GroqProvider(BaseProvider):
    code = "groq"

    async def generate_structured(self, model, token, instructions, content, schema):
        data = await request(self.code, "POST", "chat/completions", token, {
            "model": model, "messages": [{"role": "system", "content": instructions}, {"role": "user", "content": content}],
            "stream": False, "max_completion_tokens": 900,
            "response_format": {"type": "json_schema", "json_schema": {"name": "offer_review", "strict": True, "schema": schema}},
        })
        choices = data.get("choices") or []
        choice = choices[0] if choices else {}
        usage = data.get("usage")
        normalized = {"input_tokens": usage.get("prompt_tokens", 0), "output_tokens": usage.get("completion_tokens", 0), "total_tokens": usage.get("total_tokens")} if isinstance(usage, dict) else None
        return LLMResult(choice.get("message", {}).get("content") or "", normalized, data.get("id"), choice.get("finish_reason") == "stop")


class OpenAIProvider(BaseProvider):
    code = "openai"

    async def generate_structured(self, model, token, instructions, content, schema):
        data = await request(self.code, "POST", "responses", token, {
            "model": model, "instructions": instructions, "input": content,
            "store": False, "max_output_tokens": 600,
            "text": {"format": {"type": "json_schema", "name": "offer_review", "strict": True, "schema": schema}},
        })
        output = "".join(part.get("text", "") for item in data.get("output", []) for part in item.get("content", []) if part.get("type") == "output_text")
        return LLMResult(output, data.get("usage"), data.get("id"), data.get("status") == "completed")


PROVIDERS: dict[str, LLMProvider] = {"groq": GroqProvider(), "openai": OpenAIProvider()}
