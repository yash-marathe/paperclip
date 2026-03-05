DROP INDEX "agent_api_keys_key_hash_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "agent_api_keys_key_hash_uniq_idx" ON "agent_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "session_token_idx" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "goals_company_parent_idx" ON "goals" USING btree ("company_id","parent_id");--> statement-breakpoint
CREATE INDEX "heartbeat_runs_agent_status_idx" ON "heartbeat_runs" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "issues_execution_run_idx" ON "issues" USING btree ("execution_run_id");--> statement-breakpoint
CREATE INDEX "issues_company_goal_idx" ON "issues" USING btree ("company_id","goal_id");