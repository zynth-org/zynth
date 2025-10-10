import { minLength, object, optional, pipe, string, uuid } from "valibot";

const generateRequestSchema = object({
  prompt: pipe(string(), minLength(1, "prompt is required")),
  appId: optional(pipe(string(), uuid("appId must be a valid UUID"))),
});

export { generateRequestSchema };