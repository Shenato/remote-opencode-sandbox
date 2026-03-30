import type { Template } from "../types.ts";
import { webSupabaseTemplate } from "./web-supabase.ts";
import { nodeBasicTemplate } from "./node-basic.ts";
import { godotGamedevTemplate } from "./godot-gamedev.ts";

const builtinTemplates: Record<string, Template> = {
  "web-supabase": webSupabaseTemplate,
  "node-basic": nodeBasicTemplate,
  "godot-gamedev": godotGamedevTemplate,
};

export function loadBuiltinTemplate(name: string): Template | null {
  return builtinTemplates[name] ?? null;
}

export function listTemplates(): Template[] {
  return Object.values(builtinTemplates);
}

export function templateExists(name: string): boolean {
  return name in builtinTemplates;
}
