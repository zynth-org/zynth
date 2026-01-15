import type { BaseIssue, BaseSchema, InferOutput } from "valibot";
import { safeParse } from "valibot";

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: BaseIssue<unknown>[] };

function validate<TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>>(
  schema: TSchema,
  input: unknown,
): ValidationResult<InferOutput<TSchema>> {
  const result = safeParse(schema, input);
  if (result.success) {
    return { ok: true, value: result.output };
  }
  return { ok: false, issues: result.issues };
}

function formatIssues(issues: BaseIssue<unknown>[]) {
  return issues.map((issue) => ({
    message: issue.message,
    path: formatPath(issue.path),
  }));
}

function formatPath(path: BaseIssue<unknown>["path"]) {
  if (!path?.length) return null;
  return path
    .map((item) => (typeof item.key === "string" || typeof item.key === "number" ? String(item.key) : ""))
    .filter(Boolean)
    .join(".");
}

export { formatIssues, validate };
