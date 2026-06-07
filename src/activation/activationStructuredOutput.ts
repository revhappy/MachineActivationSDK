import type { ActivationCompletionOptions } from './activationAdapter';

export const ACTIVATION_JSON_GBNF = String.raw`root ::= ws value ws
value ::= object | array | string | number | boolean | null
object ::= "{" ws (string ws ":" ws value (ws "," ws string ws ":" ws value)*)? "}"
array ::= "[" ws (value (ws "," ws value)*)? "]"
string ::= "\"" chars "\""
chars ::= char*
char ::= [^"\\\x7F\x00-\x1F] | "\\" escape
escape ::= ["\\/bfnrt] | "u" hex hex hex hex
hex ::= [0-9a-fA-F]
number ::= "-"? int frac? exp?
int ::= "0" | [1-9] [0-9]*
frac ::= "." [0-9]+
exp ::= [eE] [-+]? [0-9]+
boolean ::= "true" | "false"
null ::= "null"
ws ::= [ \t\n\r]*`;

export function resolveStructuredOutputGrammar(
  backendId: string,
  options: Pick<ActivationCompletionOptions, 'grammar' | 'responseFormat'>,
): string | undefined {
  if (typeof options.grammar === 'string' && options.grammar.trim().length > 0) {
    return options.grammar;
  }

  if (options.responseFormat === 'json' && isLlamaFamilyBackend(backendId)) {
    return ACTIVATION_JSON_GBNF;
  }

  return undefined;
}

export function isLlamaFamilyBackend(backendId: string): boolean {
  return /\bllama\b/i.test(backendId);
}
