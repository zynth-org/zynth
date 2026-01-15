ALTER TABLE "projects" RENAME TO "apps";--> statement-breakpoint
ALTER TABLE "generation_requests" RENAME COLUMN "project_id" TO "app_id";--> statement-breakpoint
ALTER TABLE "agent_runs" RENAME COLUMN "project_id" TO "app_id";--> statement-breakpoint
ALTER TABLE "generation_requests" DROP CONSTRAINT "generation_requests_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_runs" DROP CONSTRAINT "agent_runs_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "generation_requests" ADD CONSTRAINT "generation_requests_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;