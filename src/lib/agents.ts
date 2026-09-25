import { CALL_LANGUAGES, LANGUAGE_LABELS, type CallLanguage } from "./routing";

// Server configuration only. Browser components receive language names, never credentials.
export type DispatchAgent = { id: string; language: CallLanguage; label: string };
export function getDispatchAgents(): Partial<Record<CallLanguage, DispatchAgent>> {
  const ids = { hindi: process.env.BOLNA_HINDI_AGENT_ID || process.env.BOLNA_AGENT_ID, english: process.env.BOLNA_ENGLISH_AGENT_ID };
  return Object.fromEntries(CALL_LANGUAGES.filter(language => ids[language]?.trim()).map(language => [language,
    { id: ids[language]!.trim().toLowerCase(), language, label: LANGUAGE_LABELS[language] }]));
}
export function getConfiguredLanguages(): CallLanguage[] {
  const agents = getDispatchAgents();
  return CALL_LANGUAGES.filter(language => !!agents[language]);
}
export function agentLabel(id: string | null | undefined, language?: string | null): string {
  if (language === "hindi" || language === "english") return LANGUAGE_LABELS[language];
  const agent = Object.values(getDispatchAgents()).find(agent => agent.id === id);
  return agent?.label || (id ? `${id.slice(0, 8)}…` : "—");
}
