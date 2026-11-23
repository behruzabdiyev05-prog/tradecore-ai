-- Rollback of 20261125001900_trade_documents.sql — removes trade documents and their lines.
-- Ledger rows already posted to financial_transactions stay (they are the company's books).
drop function if exists public.trade_document_post(uuid);
drop function if exists public._trade_document_mark_posted(uuid);
drop function if exists public.trade_line_total(public.trade_document_lines);
drop table if exists public.trade_document_lines;
drop table if exists public.trade_documents;
drop function if exists public.trade_documents_guard();
drop function if exists public.trade_lines_guard();
