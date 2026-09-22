from typing import Literal
from pydantic import BaseModel, Field, ConfigDict


class SearchQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["digital_sales", "sales", "closer", "setter", "cold_caller", "sdr", "account_executive", "custom"] = "sales"
    keywords: str = Field(default="", max_length=120)
    market: Literal["any", "ES", "EU", "LATAM", "US"] = "any"
    language: Literal["any", "es", "en"] = "any"
    days: int = Field(default=10, ge=1, le=90)
    salary_min: float = Field(default=0, ge=0, le=100000)
    salary_currency: Literal["EUR", "USD"] = "EUR"
    salary_mode: Literal["prefer", "strict"] = "prefer"
    include_unknown: bool = True
    require_spanish: bool = False
    work_mode: Literal["remote_hybrid", "remote", "any"] = "remote_hybrid"
    sources: list[str] = Field(
        default_factory=lambda: ["himalayas", "weworkremotely"], min_length=1, max_length=40
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
    first_seen_at: str | None = None
    catalog_expires_at: str | None = None
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


class SourceSearch(BaseModel):
    name: str
    url: str
    language: str
    preferred: bool


class SourceInfo(BaseModel):
    suggested_searches: list[SourceSearch] = Field(default_factory=list)
    acquisition_method: str = ""
    upstream_filters: list[str] = Field(default_factory=list)
    acquisition_note: str = ""
    validation_status: str = ""
    provider_candidates: list[str] = Field(default_factory=list)
    checked_at: str = ""
    code: str
    name: str
    available: bool
    note: str
    category: str = "Internacional"
    website: str = ""
    setup_url: str = ""


class Configuration(BaseModel):
    organization: str
    product_name: str
    mode: str = "local"
    sources: list[SourceInfo]
