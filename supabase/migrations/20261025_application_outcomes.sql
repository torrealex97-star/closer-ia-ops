-- APLICADA en Supabase (2026-10-25, por orden del dueño) y verificada leyendo la restricción. Aditiva y reversible.
-- Resultado de cada candidatura DECLARADO por la alumna (hoy no hay correo entrante que lo detecte): la candidatura enviada
-- puede pasar a «responded» (la empresa ha contestado), «interview», «offer» o «rejected». Solo amplía el CHECK de estado;
-- no añade columnas, así que las lecturas actuales no cambian. Reversión: volver al CHECK de cuatro estados tras pasar a
-- «applied» las filas con los estados nuevos.
alter table public.student_applications drop constraint if exists student_applications_status_check;
alter table public.student_applications add constraint student_applications_status_check
  check (status in ('draft','opened','applied','discarded','responded','interview','offer','rejected'));
