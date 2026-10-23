// The compact form of the GraphQL contract (scripts/gen-schema.mjs writes it in schema.generated.ts).

/** A field or an operation: its type ("[Post!]!") and its arguments (name → type). */
export type SdlField = [string, Record<string, string>?];
export type SdlType = { k: 'o' | 'i' | 'e' | 'u' | 's'; f?: Record<string, SdlField>; v?: string[] };
export type Sdl = { types: Record<string, SdlType>; query: Record<string, SdlField>; mutation: Record<string, SdlField> };
