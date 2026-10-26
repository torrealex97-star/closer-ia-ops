-- APLICADA en Supabase (2026-10-26, por orden del dueño de hacer las acciones recomendadas). Aditiva y reversible (drop index).
-- Índice de cobertura de la clave foránea student_id de student_voice_consent (aviso del asesor de rendimiento).
create index if not exists student_voice_consent_student_idx on public.student_voice_consent (student_id);
