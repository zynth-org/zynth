import type { InferOutput } from "valibot";
import { generateRequestSchema } from "../schemas/generate.js";

type GenerateRequest = InferOutput<typeof generateRequestSchema>;

export type { GenerateRequest };
