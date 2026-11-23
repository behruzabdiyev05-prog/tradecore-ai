-- Rollback of 20261125002100_trading.sql — removes the trading journal tables.
drop table if exists public.trading_alerts;
drop table if exists public.trading_prices;
drop table if exists public.trading_trades;
drop table if exists public.trading_accounts;
drop function if exists public.trading_alerts_check();
