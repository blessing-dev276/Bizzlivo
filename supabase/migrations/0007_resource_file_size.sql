-- File size shown on the Resources page (e.g. "2.4 MB"). Populated client-side
-- from the browser File object at upload time; null for resources uploaded
-- before this column existed.
alter table resources add column file_size_bytes bigint;
