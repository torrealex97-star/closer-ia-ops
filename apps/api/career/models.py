from typing import Literal
from pydantic import BaseModel, Field, ConfigDict


class SearchQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["sales", "closer", "setter", "sdr", "account_executive", "custom"] = "sales"
    keywords: str = Field(default="", max_length=120)
    market: Literal["any", "ES", "LATAM", "US"] = "any"
    language: Literal["any", "es", "en"] = "any"
    days: int = Field(default=30, ge=1, le=90)
    salary_min: float = Field(default=0, ge=0, le=100000)
    salary_currency: Literal["EUR", "USD"] = "EUR"
    salary_mode: Literal["prefer", "strict"] = "prefer"
    include_unknown: bool = True
    sources: list[Literal["himalayas", "weworkremotely"]] = Field(
        default_factory=lambda: ["himalayas", "weworkremotely"], min_length=1, max_length=2
    )


class SearchRequest(BaseModel):
    query: SearchQuery
    idempotency_key: str = Field(min_length=8, max_length=100)


class SourceProgress(BaseModel):
    code: str
    name: str
    status: str = "queued"
    fetched: int = 0
    accepted: int = 0
    warning: str | None = None
    latency_ms: int | None = None
    cost: float = 0


class Job(BaseModel):
    id: str
    title: str
    company: str
    description: str
    source: str
    source_url: str
    application_url: str
    locations: list[str]
    published_at: str | None
    salary_min: float | None = None
    salary_max: float | None = None
    salary_currency: str | None = None
    salary_period: str | None = None
    score: int
    reasons: list[str]
    warnings: list[str]
    raw_id: str
    captured_at: str
    provider: str
    starred: bool = False


class SearchRun(BaseModel):
    id: str
    query: SearchQuery
    status: str
    created_at: str
    completed_at: str | None = None
    sources: list[SourceProgress]
    jobs: list[Job] = Field(default_factory=list)


class ExportRequest(BaseModel):
    run_id: str
    job_ids: list[str] = Field(min_length=1, max_length=500)
    format: Literal["csv", "json", "xlsx"]


class StarRequest(BaseModel):
    starred: bool


class SavedRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    query: SearchQuery


class SavedSearch(BaseModel):
    id: str
    name: str
    query: SearchQuery


class SourceInfo(BaseModel):
    code: str
    name: str
    available: bool
    note: str


class Configuration(BaseModel):
    organization: str
    product_name: str
    mode: str = "local"
    sources: list[SourceInfo]
